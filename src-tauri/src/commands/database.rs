//! Pont transactionnel SQLite : un lot IPC s'exécute sur une seule transaction SQLx.

use std::fmt;

use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_URL: &str = "sqlite:logassist.db";
const MAX_STATEMENTS: usize = 1_024;
const MAX_QUERY_BYTES: usize = 64 * 1_024;
const MAX_BINDS: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionStatement {
    sql: String,
    values: Vec<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransactionError {
    InvalidBatch,
    Database,
}

impl fmt::Display for TransactionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBatch => formatter.write_str("Lot transactionnel invalide"),
            Self::Database => formatter.write_str("Transaction SQLite impossible"),
        }
    }
}

enum SqliteBind {
    Null,
    Bool(bool),
    Integer(i64),
    Float(f64),
    Text(String),
}

struct ValidatedStatement {
    sql: String,
    values: Vec<SqliteBind>,
}

fn validate_value(value: Value) -> Result<SqliteBind, TransactionError> {
    match value {
        Value::Null => Ok(SqliteBind::Null),
        Value::Bool(value) => Ok(SqliteBind::Bool(value)),
        Value::String(value) => Ok(SqliteBind::Text(value)),
        Value::Number(number) if number.is_i64() => number
            .as_i64()
            .map(SqliteBind::Integer)
            .ok_or(TransactionError::InvalidBatch),
        Value::Number(number) if number.is_u64() => number
            .as_u64()
            .and_then(|value| i64::try_from(value).ok())
            .map(SqliteBind::Integer)
            .ok_or(TransactionError::InvalidBatch),
        Value::Number(number) => number
            .as_f64()
            .filter(|value| value.is_finite())
            .map(SqliteBind::Float)
            .ok_or(TransactionError::InvalidBatch),
        Value::Array(_) | Value::Object(_) => Err(TransactionError::InvalidBatch),
    }
}

fn validate_statements(
    statements: Vec<TransactionStatement>,
) -> Result<Vec<ValidatedStatement>, TransactionError> {
    if statements.is_empty() || statements.len() > MAX_STATEMENTS {
        return Err(TransactionError::InvalidBatch);
    }

    statements
        .into_iter()
        .map(|statement| {
            if statement.sql.trim().is_empty()
                || statement.sql.len() > MAX_QUERY_BYTES
                || statement.values.len() > MAX_BINDS
            {
                return Err(TransactionError::InvalidBatch);
            }

            let values = statement
                .values
                .into_iter()
                .map(validate_value)
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ValidatedStatement {
                sql: statement.sql,
                values,
            })
        })
        .collect()
}

async fn execute_on_pool(
    pool: &SqlitePool,
    statements: Vec<TransactionStatement>,
) -> Result<(), TransactionError> {
    let statements = validate_statements(statements)?;
    let mut transaction = pool.begin().await.map_err(|_| TransactionError::Database)?;

    for statement in statements {
        let mut query = sqlx::query(&statement.sql);
        for value in statement.values {
            query = match value {
                SqliteBind::Null => query.bind(Option::<String>::None),
                SqliteBind::Bool(value) => query.bind(value),
                SqliteBind::Integer(value) => query.bind(value),
                SqliteBind::Float(value) => query.bind(value),
                SqliteBind::Text(value) => query.bind(value),
            };
        }

        if query.execute(&mut *transaction).await.is_err() {
            let error = TransactionError::Database;
            let _ = transaction.rollback().await;
            return Err(error);
        }
    }

    transaction
        .commit()
        .await
        .map_err(|_| TransactionError::Database)
}

#[tauri::command]
pub async fn execute_transaction(
    db_instances: State<'_, DbInstances>,
    statements: Vec<TransactionStatement>,
) -> Result<(), String> {
    // Le clone libère le read-lock du registre avant l'ouverture de la transaction.
    let pool = {
        let instances = db_instances.0.read().await;
        let db = instances
            .get(DATABASE_URL)
            .ok_or_else(|| TransactionError::Database.to_string())?;
        let DbPool::Sqlite(pool) = db;
        pool.clone()
    };

    execute_on_pool(&pool, statements)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::{SqlitePool, query, query_scalar, sqlite::SqlitePoolOptions};

    use super::{TransactionError, TransactionStatement, execute_on_pool};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .expect("le pool SQLite de test doit être créé");
        query(
            "CREATE TABLE transaction_items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                score REAL NOT NULL,
                note TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("la table de test doit être créée");
        pool
    }

    fn statement(sql: impl Into<String>, values: Vec<Value>) -> TransactionStatement {
        TransactionStatement {
            sql: sql.into(),
            values,
        }
    }

    async fn row_count(pool: &SqlitePool) -> i64 {
        query_scalar::<_, i64>("SELECT COUNT(*) FROM transaction_items")
            .fetch_one(pool)
            .await
            .expect("le nombre de lignes doit être lisible")
    }

    #[tokio::test]
    async fn commits_two_valid_inserts_on_one_transaction_connection() {
        let pool = test_pool().await;
        let _held_connection = pool
            .acquire()
            .await
            .expect("une première connexion doit pouvoir rester occupée");

        execute_on_pool(
            &pool,
            vec![
                statement(
                    "INSERT INTO transaction_items (id, name, enabled, score, note) VALUES (?, ?, ?, ?, ?)",
                    vec![json!(1_i64), json!("first"), json!(true), json!(1.5), Value::Null],
                ),
                statement(
                    "INSERT INTO transaction_items (id, name, enabled, score, note) VALUES (?, ?, ?, ?, ?)",
                    vec![json!(2_u64), json!("second"), json!(false), json!(-2_i64), json!("ok")],
                ),
            ],
        )
        .await
        .expect("le lot valide doit être commité");

        assert_eq!(row_count(&pool).await, 2);
    }

    #[tokio::test]
    async fn rolls_back_the_first_insert_when_the_second_statement_fails() {
        let pool = test_pool().await;

        let result = execute_on_pool(
            &pool,
            vec![
                statement(
                    "INSERT INTO transaction_items (id, name, enabled, score) VALUES (?, ?, ?, ?)",
                    vec![json!(1), json!("first"), json!(true), json!(1.0)],
                ),
                statement("INSERT INTO missing_table (id) VALUES (?)", vec![json!(2)]),
            ],
        )
        .await;

        assert_eq!(result, Err(TransactionError::Database));
        assert_eq!(row_count(&pool).await, 0);
    }

    #[tokio::test]
    async fn rejects_arrays_objects_and_out_of_range_unsigned_numbers_without_writing() {
        let pool = test_pool().await;

        for invalid_value in [
            json!(["forbidden"]),
            json!({ "forbidden": true }),
            json!(u64::MAX),
        ] {
            let result = execute_on_pool(
                &pool,
                vec![
                    statement(
                        "INSERT INTO transaction_items (id, name, enabled, score) VALUES (?, ?, ?, ?)",
                        vec![json!(1), json!("before"), json!(true), json!(1.0)],
                    ),
                    statement(
                        "INSERT INTO transaction_items (id, name, enabled, score) VALUES (?, ?, ?, ?)",
                        vec![json!(2), invalid_value, json!(true), json!(1.0)],
                    ),
                ],
            )
            .await;

            assert_eq!(result, Err(TransactionError::InvalidBatch));
            assert_eq!(row_count(&pool).await, 0);
        }
    }

    #[tokio::test]
    async fn rejects_invalid_batch_and_statement_limits() {
        let pool = test_pool().await;

        assert_eq!(
            execute_on_pool(&pool, Vec::new()).await,
            Err(TransactionError::InvalidBatch)
        );

        let oversized_batch = (0..1_025)
            .map(|_| statement("SELECT 1", Vec::new()))
            .collect();
        assert_eq!(
            execute_on_pool(&pool, oversized_batch).await,
            Err(TransactionError::InvalidBatch)
        );
        assert_eq!(
            execute_on_pool(&pool, vec![statement("   ", Vec::new())]).await,
            Err(TransactionError::InvalidBatch)
        );
        assert_eq!(
            execute_on_pool(
                &pool,
                vec![statement("x".repeat(64 * 1_024 + 1), Vec::new())],
            )
            .await,
            Err(TransactionError::InvalidBatch)
        );
        assert_eq!(
            execute_on_pool(&pool, vec![statement("SELECT 1", vec![Value::Null; 65])],).await,
            Err(TransactionError::InvalidBatch)
        );
    }

    #[tokio::test]
    async fn accepts_a_valid_batch_after_a_rollback() {
        let pool = test_pool().await;

        let failed = execute_on_pool(
            &pool,
            vec![
                statement(
                    "INSERT INTO transaction_items (id, name, enabled, score) VALUES (?, ?, ?, ?)",
                    vec![json!(1), json!("rolled back"), json!(true), json!(1.0)],
                ),
                statement("SQL volontairement invalide", Vec::new()),
            ],
        )
        .await;
        assert_eq!(failed, Err(TransactionError::Database));

        execute_on_pool(
            &pool,
            vec![statement(
                "INSERT INTO transaction_items (id, name, enabled, score) VALUES (?, ?, ?, ?)",
                vec![json!(2), json!("committed"), json!(true), json!(2.0)],
            )],
        )
        .await
        .expect("un lot valide doit réussir après le rollback");

        assert_eq!(row_count(&pool).await, 1);
    }
}
