import { t } from "@/i18n/fr";

function App() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">{t.app.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.app.subtitle}</p>
    </main>
  );
}

export default App;
