import { foundationSummary } from "@/shared/foundation/foundation";

export default function Home() {
  return (
    <main className="flex min-h-full items-center justify-center bg-slate-950 px-6 py-16 text-slate-100">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl sm:p-12">
        <div className="mb-10 flex items-center justify-between gap-4">
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">AI Website Factory</span>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">Foundation</span>
        </div>
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">{foundationSummary.name}</h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">{foundationSummary.description}</p>
        <div className="mt-10 border-t border-slate-800 pt-6">
          <p className="text-sm font-medium text-emerald-300">● {foundationSummary.status}</p>
          <p className="mt-2 text-sm text-slate-400">Workflow orchestration, project generation, and integrations are planned for later stages.</p>
        </div>
      </section>
    </main>
  );
}
