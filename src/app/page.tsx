"use client";

import { useCallback, useMemo, useState } from "react";

type Article = {
  id: string;
  url: string;
  domain: string;
  title: string;
  byline?: string | null;
  content: string;
  loading: boolean;
  error?: string;
};

function generateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBroadsheetDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function extractLeadFigureAndTagLeadParagraphClient(contentHtml: string): {
  leadFigureHtml: string | null;
  contentHtml: string;
} {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${contentHtml}</body>`, "text/html");

    const firstParagraph = doc.querySelector("p");
    if (firstParagraph) firstParagraph.classList.add("lead");

    const figureWithImg = doc.querySelector("figure img")?.closest("figure") ?? null;
    const imgEl = doc.querySelector("img");

    let leadFigureHtml: string | null = null;

    if (figureWithImg) {
      const cloned = figureWithImg.cloneNode(true) as HTMLElement;
      cloned.classList.add("lead-figure");
      leadFigureHtml = cloned.outerHTML;
      figureWithImg.remove();
    } else if (imgEl) {
      const cloned = imgEl.cloneNode(true) as HTMLImageElement;
      cloned.classList.add("lead-image");
      const captionText = cloned.getAttribute("alt")?.trim();
      leadFigureHtml = `
        <figure class="lead-figure">
          ${cloned.outerHTML}
          ${
            captionText
              ? `<figcaption class="lead-caption">${escapeHtml(captionText)}</figcaption>`
              : ""
          }
        </figure>
      `;
      imgEl.remove();
    }

    return {
      leadFigureHtml,
      contentHtml: doc.body.innerHTML,
    };
  } catch {
    return { leadFigureHtml: null, contentHtml };
  }
}

function buildNewspaperPreviewHtml(article: Article) {
  const publicationTitle = "The Offline Broadsheet";
  const issueDate = formatBroadsheetDate(new Date());

  const safeTitle = escapeHtml(article.title || article.url);
  const safeDomain = escapeHtml(article.domain || new URL(article.url).hostname);
  const safeUrl = escapeHtml(article.url);
  const sourceLine = escapeHtml(`${safeDomain} \u2022 ${article.url}`);
  const byline =
    article.byline && article.byline.trim().length > 0
      ? escapeHtml(article.byline.trim())
      : null;

  const { leadFigureHtml, contentHtml } =
    extractLeadFigureAndTagLeadParagraphClient(article.content);

  return `
    <div class="newspaper">
      <header class="masthead">
        <h1 class="masthead-title">${escapeHtml(publicationTitle)}</h1>
        <p class="masthead-date">${escapeHtml(issueDate)}</p>
        <hr class="masthead-rule" aria-hidden="true" />
      </header>

      <article class="article">
        <header class="article-header">
          <h1 class="article-title">${safeTitle}</h1>
          ${byline ? `<p class="article-byline">${byline}</p>` : ""}
          <p class="article-meta">${sourceLine}</p>
        </header>

        ${leadFigureHtml ?? ""}

        <section class="article-body">
          ${contentHtml}
        </section>
      </article>

      <footer class="preview-footer">
        <p class="preview-source">
          Previewing: <span class="preview-domain">${safeDomain}</span> <span class="preview-dot">\u2022</span>
          <span class="preview-url">${safeUrl}</span>
        </p>
      </footer>
    </div>
  `;
}

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);

  const MAX_ARTICLES = 3;

  const hasReadyArticles = useMemo(
    () => articles.some((a) => !a.loading && !a.error),
    [articles],
  );

  const isAtArticleLimit = articles.length >= MAX_ARTICLES;

  const handleAddArticle = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    try {
      if (articles.length >= MAX_ARTICLES) {
        setQueueMessage("Maximum of 3 articles allowed per broadsheet.");
        return;
      }

      let validatedUrl: string;
      try {
        const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
        validatedUrl = parsed.toString();
      } catch {
        setGlobalError("Please enter a valid URL.");
        return;
      }

      setGlobalError(null);
      setQueueMessage(null);

      const id = generateId();
      setArticles((prev) => [
        ...prev,
        {
          id,
          url: validatedUrl,
          domain: "",
          title: "",
          byline: null,
          content: "",
          loading: true,
        },
      ]);
      setUrlInput("");

      const res = await fetch("/api/extract-article", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: validatedUrl }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          errorText || "Failed to extract article content from this URL.",
        );
      }

      const data = await res.json();

      setArticles((prev) =>
        prev.map((article) =>
          article.id === id
            ? {
                ...article,
                domain: data.domain ?? "",
                title: data.title ?? article.url,
                byline: data.byline ?? null,
                content: data.content ?? "",
                loading: false,
                error: undefined,
              }
            : article,
        ),
      );

      setSelectedId((current) => current ?? id);
    } catch (error) {
      console.error(error);
      setArticles((prev) =>
        prev.map((article) =>
          article.loading && !article.error
            ? {
                ...article,
                loading: false,
                error:
                  "Could not load this article. The site may be blocking automated requests.",
              }
            : article,
        ),
      );
    }
  }, [articles.length, urlInput]);

  const handleRemoveArticle = useCallback((id: string) => {
    setArticles((prev) => prev.filter((article) => article.id !== id));
    setSelectedId((current) => {
      if (current !== id) return current;
      const remaining = articles.filter((article) => article.id !== id);
      return remaining[0]?.id ?? null;
    });
    setQueueMessage(null);
  }, [articles]);

  const moveArticle = useCallback(
    (id: string, direction: "up" | "down") => {
      setArticles((prev) => {
        const index = prev.findIndex((article) => article.id === id);
        if (index === -1) return prev;

        const newIndex = direction === "up" ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= prev.length) return prev;

        const copy = [...prev];
        const [moved] = copy.splice(index, 1);
        copy.splice(newIndex, 0, moved);
        return copy;
      });
    },
    [],
  );

  const handleGeneratePdf = useCallback(async () => {
    if (!hasReadyArticles) {
      setGlobalError("Please add at least one valid article first.");
      return;
    }

    setIsGenerating(true);
    setGlobalError(null);

    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
      setDownloadFilename(null);
    }

    try {
      const payload = articles
        .filter((a) => !a.loading && !a.error)
        .map((a) => ({
          title: a.title || a.url,
          url: a.url,
          domain: a.domain,
          byline: a.byline ?? undefined,
          content: a.content,
        }));

      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ articles: payload }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to generate PDF.");
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const filename = `articles-${new Date().toISOString().slice(0, 10)}.pdf`;

      setDownloadUrl(objectUrl);
      setDownloadFilename(filename);
    } catch (error) {
      console.error(error);
      setGlobalError("Failed to generate PDF. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [articles, downloadUrl, hasReadyArticles]);

  const selectedArticle = useMemo(
    () => articles.find((article) => article.id === selectedId) ?? null,
    [articles, selectedId],
  );

  return (
    <div
      className={`min-h-screen transition-colors ${
        isDark ? "bg-[#0b0b10] text-neutral-100" : "bg-[#f5f5f0] text-neutral-900"
      }`}
    >
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Masthead */}
        <header className="mb-6 border-b border-neutral-300 pb-4 sm:mb-8 sm:pb-6 lg:mb-10 lg:pb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1
                className={`font-headline text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl ${
                  isDark ? "text-neutral-50" : "text-neutral-900"
                }`}
              >
                The Offline Broadsheet
              </h1>
              <p
                className={`mt-2 max-w-xl text-sm sm:text-base ${
                  isDark ? "text-neutral-300" : "text-neutral-600"
                }`}
              >
                Collect articles from the web, skim them in a clean preview, and export a
                newspaper-style PDF for offline reading.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsDark((prev) => !prev)}
              className={`mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition ${
                isDark
                  ? "border-neutral-600 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                  : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100"
              }`}
              aria-label="Toggle dark mode"
            >
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  isDark ? "bg-neutral-700 text-amber-200" : "bg-amber-300 text-amber-900"
                }`}
              >
                {isDark ? "☾" : "☀"}
              </span>
              <span>{isDark ? "Dark" : "Light"} mode</span>
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          {/* Left column: URL input + article list */}
          <div className="flex w-full flex-col gap-6 lg:w-[42%]">
            {/* URL input card */}
            <section
              className={`rounded-xl border p-5 shadow-sm sm:p-6 ${
                isDark
                  ? "border-neutral-800 bg-neutral-900/70"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <label
                htmlFor="url-input"
                className="mb-3 block text-sm font-medium text-neutral-800"
              >
                Article URL
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="url-input"
                  type="url"
                  placeholder="https://example.com/article"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddArticle();
                    }
                  }}
                  className={`flex-1 rounded-md border px-4 py-2.5 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-1 ${
                    isDark
                      ? "border-neutral-700 bg-neutral-900 text-neutral-50 focus:border-neutral-400 focus:ring-neutral-500"
                      : "border-neutral-300 bg-white text-neutral-900 focus:border-neutral-500 focus:ring-neutral-500"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => void handleAddArticle()}
                  disabled={!urlInput.trim() || isAtArticleLimit}
                  className={`inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed ${
                    isDark
                      ? "bg-neutral-100 text-neutral-900 hover:bg-white disabled:bg-neutral-600 disabled:text-neutral-300"
                      : "bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-400"
                  }`}
                >
                  Add Article
                </button>
              </div>
              <p
                className={`mt-2 text-xs ${
                  isDark ? "text-neutral-400" : "text-neutral-500"
                }`}
              >
                Paste article URLs to build your reading queue; each article is cleaned up
                automatically.
              </p>
              {queueMessage && (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  {queueMessage}
                </p>
              )}
            </section>

            {/* Article list card */}
            <section
              className={`flex flex-1 flex-col rounded-xl border p-5 shadow-sm sm:p-6 ${
                isDark
                  ? "border-neutral-800 bg-neutral-900/70"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2
                  className={`font-headline text-lg font-semibold ${
                    isDark ? "text-neutral-50" : "text-neutral-900"
                  }`}
                >
                  Reading queue
                </h2>
                <span
                  className={`text-xs ${
                    isDark ? "text-neutral-400" : "text-neutral-500"
                  }`}
                >
                  {articles.length === 0
                    ? "No articles"
                    : `${articles.length} article${articles.length > 1 ? "s" : ""}`}
                </span>
              </div>
              <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
                {articles.length === 0 ? (
                  <p
                    className={`py-8 text-center text-sm ${
                      isDark ? "text-neutral-500" : "text-neutral-500"
                    }`}
                  >
                    Paste a URL above to add your first article.
                  </p>
                ) : (
                  articles.map((article, index) => {
                    const isSelected = article.id === selectedId;
                    const isFirst = index === 0;
                    const isLast = index === articles.length - 1;

                    return (
                      <article
                        key={article.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(article.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId(article.id);
                          }
                        }}
                        className={`group flex cursor-pointer gap-3 rounded-lg border p-4 text-left transition ${
                          isSelected
                            ? isDark
                              ? "border-neutral-500 bg-neutral-800 text-white"
                              : "border-neutral-800 bg-neutral-900 text-white"
                            : isDark
                              ? "border-neutral-700 bg-neutral-900/60 hover:border-neutral-500 hover:bg-neutral-900"
                              : "border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-neutral-100"
                        }`}
                      >
                        <div className="flex shrink-0 flex-col gap-0.5">
                          <button
                            type="button"
                            className={`rounded p-1 transition disabled:opacity-30 disabled:hover:bg-transparent ${
                              isSelected
                                ? "text-neutral-300 hover:bg-neutral-700 hover:text-white"
                                : isDark
                                  ? "text-neutral-400 hover:bg-neutral-700 hover:text-white"
                                  : "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveArticle(article.id, "up");
                            }}
                            disabled={isFirst}
                            aria-label="Move up"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={`rounded p-1 transition disabled:opacity-30 disabled:hover:bg-transparent ${
                              isSelected
                                ? "text-neutral-300 hover:bg-neutral-700 hover:text-white"
                                : isDark
                                  ? "text-neutral-400 hover:bg-neutral-700 hover:text-white"
                                  : "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveArticle(article.id, "down");
                            }}
                            disabled={isLast}
                            aria-label="Move down"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`line-clamp-2 font-medium ${
                              isSelected
                                ? "text-white"
                                : isDark
                                  ? "text-neutral-50"
                                  : "text-neutral-900"
                            }`}
                          >
                            {article.title || article.url}
                          </p>
                          <p
                            className={`mt-0.5 line-clamp-1 text-xs ${
                              isSelected
                                ? "text-neutral-300"
                                : isDark
                                  ? "text-neutral-400"
                                  : "text-neutral-500"
                            }`}
                          >
                            {article.domain || new URL(article.url).hostname}
                          </p>
                          {article.loading && (
                            <p
                              className={`mt-2 text-xs ${
                                isSelected
                                  ? "text-neutral-300"
                                  : isDark
                                    ? "text-neutral-400"
                                    : "text-neutral-500"
                              }`}
                            >
                              Extracting…
                            </p>
                          )}
                          {article.error && (
                            <p
                              className={`mt-2 text-xs ${
                                isSelected
                                  ? "text-red-300"
                                  : isDark
                                    ? "text-red-400"
                                    : "text-red-600"
                              }`}
                            >
                              {article.error}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveArticle(article.id);
                          }}
                          className={`shrink-0 rounded px-2 py-1 text-xs font-medium transition ${
                            isSelected
                              ? "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                              : isDark
                                ? "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                                : "text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700"
                          }`}
                        >
                          Remove
                        </button>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            {/* Generate PDF section */}
            <section
              className={`rounded-xl border p-5 shadow-sm sm:p-6 ${
                isDark
                  ? "border-neutral-800 bg-neutral-900/70"
                  : "border-neutral-200 bg-white"
              }`}
            >
              {globalError && (
                <p className="mb-4 text-sm text-red-500">{globalError}</p>
              )}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => void handleGeneratePdf()}
                disabled={isGenerating || !hasReadyArticles}
                style={{
                  backgroundColor: isGenerating || !hasReadyArticles ? "#A1A1A1" : "#3E78B2",
                  color: "white"
                }}
                className="order-2 inline-flex items-center justify-center rounded-md px-6 py-3 text-base font-semibold shadow-sm transition disabled:cursor-not-allowed sm:order-1"
              >
                {isGenerating ? "Generating…" : "Generate PDF"}
               </button>
               
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download={downloadFilename ?? "articles.pdf"}
                    className={`order-1 inline-flex items-center justify-center rounded-md border px-4 py-2.5 text-sm font-semibold transition sm:order-2 ${
                      isDark
                        ? "border-neutral-600 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                        : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
                    }`}
                  >
                    Download PDF
                  </a>
                )}
              </div>
            </section>
          </div>

          {/* Separator */}
          <div className="hidden shrink-0 w-px bg-neutral-200 lg:block" />

          {/* Right column: Article preview */}
          <div className="flex w-full flex-col lg:w-[58%]">
            <section
              className={`flex flex-1 flex-col rounded-xl border shadow-sm ${
                isDark
                  ? "border-neutral-800 bg-neutral-900/70"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <div
                className={`border-b px-5 py-4 sm:px-6 ${
                  isDark ? "border-neutral-800" : "border-neutral-200"
                }`}
              >
                <h2
                  className={`font-headline text-lg font-semibold ${
                    isDark ? "text-neutral-50" : "text-neutral-900"
                  }`}
                >
                  Article preview
                </h2>
                <p
                  className={`mt-0.5 text-xs ${
                    isDark ? "text-neutral-400" : "text-neutral-500"
                  }`}
                >
                  How it will appear in your PDF.
                </p>
              </div>
              <div className="flex-1 px-5 py-5 sm:px-6 sm:py-6">
                {selectedArticle ? (
                  <div className="max-h-[520px] overflow-y-auto">
                    <div
                      className="newspaper-preview"
                      dangerouslySetInnerHTML={{
                        __html: buildNewspaperPreviewHtml(selectedArticle),
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                    <p
                      className={`max-w-sm text-sm ${
                        isDark ? "text-neutral-400" : "text-neutral-500"
                      }`}
                    >
                      Select an article from your queue to preview the cleaned content.
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

