// Édition figée au build par Vite (`--mode portable` charge `.env.portable`).
// Aucune bascule possible à l'exécution : le binaire portable ne peut pas se
// comporter comme l'édition bureau par accident, et inversement.
export const isPortableEdition = import.meta.env.VITE_EDITION === "portable"
