import { useState } from "react";

export function Privacy() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] font-medium text-[var(--text-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--terracotta)]"
      >
        Privacy &amp; Terms
      </button>
    );
  }

  return (
    <div className="mx-auto mt-2 max-w-md rounded-[var(--radius)] border border-[var(--border)] bg-[var(--warm-white)] px-5 py-5 text-left text-sm leading-relaxed text-[var(--text)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Privacy &amp; Terms</h2>
        <button
          onClick={() => setOpen(false)}
          className="rounded-full p-1 text-[var(--text-muted)] transition-colors hover:bg-[rgba(92,61,46,0.06)] hover:text-[var(--terracotta)]"
          aria-label="Close"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="mb-3 font-medium text-[var(--terracotta)]">
        Your photos never leave your device.
      </p>

      <p className="mb-3 text-[var(--text-muted)]">
        All face detection and comparison happens right here in your browser
        using on-device AI models. We don't upload, store, or even see your
        photos.
      </p>

      <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--brown-light)]">
        What happens when you use the app
      </h3>
      <ul className="mb-3 list-inside list-disc space-y-1 text-[var(--text-muted)]">
        <li>
          Your browser downloads AI models (~15&ndash;150 MB depending on your
          device) from our servers &mdash; these are the same for everyone, not
          personalized.
        </li>
        <li>Your photos are processed entirely on your device.</li>
        <li>
          Results stay in your browser's local storage for convenience &mdash;
          you can clear them anytime by clearing site data.
        </li>
      </ul>

      <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--brown-light)]">
        What we don't do
      </h3>
      <ul className="mb-3 list-inside list-disc space-y-1 text-[var(--text-muted)]">
        <li>We don't collect, upload, or store your photos.</li>
        <li>We don't use cookies or analytics.</li>
        <li>We don't track you.</li>
        <li>We don't require an account or any personal information.</li>
        <li>We don't sell or share any data &mdash; there's none to share.</li>
      </ul>

      <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--brown-light)]">
        Sharing
      </h3>
      <p className="mb-3 text-[var(--text-muted)]">
        When you tap "Copy" or "Share", the result image goes to your clipboard
        or your phone's share sheet &mdash; we're not involved in that step.
      </p>

      <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--brown-light)]">
        Local storage
      </h3>
      <p className="mb-3 text-[var(--text-muted)]">
        The app caches photos and face detection results in your browser's
        IndexedDB so reloads are faster. This data lives only on your device.
        Clear your browser's site data to remove it.
      </p>

      <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--brown-light)]">
        Third-party connections
      </h3>
      <p className="mb-3 text-[var(--text-muted)]">
        The only external request the app makes is downloading AI model files
        from <code className="rounded bg-[rgba(92,61,46,0.06)] px-1 py-0.5 text-xs">models.ente.io</code>.
        No other third-party services are contacted.
      </p>

      <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--brown-light)]">
        Open source
      </h3>
      <p className="text-[var(--text-muted)]">
        This entire app is{" "}
        <a
          href="https://github.com/ente-toys/lookslikeme"
          target="_blank"
          rel="noopener"
          className="font-medium text-[var(--terracotta)] underline decoration-dotted underline-offset-2"
        >
          open source
        </a>
        . You can verify everything above by reading the code yourself.
      </p>
    </div>
  );
}
