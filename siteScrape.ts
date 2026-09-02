/**
 * Reads a firm's own website so the model has real text to extract from
 * instead of being asked to remember who works somewhere.
 *
 * The distinction matters. Asked "who works at Acme Ventures", a model
 * produces plausible names — some right, some from three years ago, some
 * invented. Handed the text of acmevc.com/team and asked which names appear
 * in it, the same model is doing extraction, which it is reliable at, and the
 * answer can be checked against a URL we can show the user.
 */

const FETCH_TIMEOUT_MS = 7000;
const MAX_PAGES = 4;
const MAX_TEXT_PER_PAGE = 14000;
const USER_AGENT = 'StratosCRM/1.0 (+contact via gostratos.vc)';

/**
 * Link words that suggest a page lists the firm's people, weighted.
 *
 * Only a handful of pages get fetched, so ordering decides what we actually
 * read. A dedicated team page beats an About page, which is mostly prose about
 * the fund's philosophy with maybe two names in it.
 *
 * 'investors' and 'founders' are deliberately absent. On a VC site /investors
 * is the LP page and /founders is about portfolio founders — both would spend
 * one of our four fetches on the wrong page.
 */
const TEAM_HINTS: { word: string; weight: number }[] = [
  { word: 'meet-the-team', weight: 6 },
  { word: 'our-team', weight: 6 },
  { word: 'ourteam', weight: 6 },
  { word: 'our-people', weight: 6 },
  { word: 'team', weight: 5 },
  { word: 'people', weight: 5 },
  { word: 'partners', weight: 4 },
  { word: 'leadership', weight: 4 },
  { word: 'staff', weight: 4 },
  { word: 'who-we-are', weight: 2 },
  { word: 'about-us', weight: 2 },
  { word: 'about', weight: 1 },
];

export interface FetchedPage {
  url: string;
  text: string;
}

/**
 * Refuses anything that is not a public http(s) address.
 *
 * The URL comes from a text field a user typed, and the server fetches it —
 * which is exactly the shape of a request-forgery bug. Without this, someone
 * could put http://169.254.169.254/ in the website field and have App Engine
 * fetch its own metadata server, credentials and all.
 */
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (host === 'metadata.google.internal') return false;

  // Literal IPs: allow none. A firm's website is a hostname, never a raw IP,
  // so this costs nothing and closes the whole private-range question.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(':')) return false; // IPv6 literal

  return true;
}

async function fetchText(url: string): Promise<string | null> {
  if (!isSafePublicUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strips markup to readable text. Good enough to find names and job titles. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Finds links on a page that look like they lead to the people who work there. */
export function findTeamLinks(html: string, baseUrl: string): string[] {
  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>();

  const anchors = html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi);
  for (const match of anchors) {
    const href = match[1];
    const label = htmlToText(match[2]).toLowerCase();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString().split('#')[0];
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;

    // Stay on the firm's own site.
    try {
      if (new URL(absolute).hostname !== new URL(baseUrl).hostname) continue;
    } catch {
      continue;
    }

    const path = absolute.toLowerCase();
    const labelSlug = label.replace(/\s+/g, '-');
    let score = 0;
    for (const { word, weight } of TEAM_HINTS) {
      if (path.includes('/' + word)) score += weight;
      if (labelSlug === word) score += weight;
      else if (label.includes(word)) score += Math.ceil(weight / 3);
    }
    if (score === 0) continue;

    seen.add(absolute);
    scored.push({ url: absolute, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_PAGES).map(s => s.url);
}

/**
 * Fetches a firm's homepage and its most team-looking pages.
 *
 * Returns whatever it managed to get. A site that blocks us, redirects to a
 * login, or renders entirely in JavaScript yields nothing — that is expected,
 * and the caller falls back to search rather than treating it as an error.
 */
export async function fetchFirmPages(website: string): Promise<FetchedPage[]> {
  let root = website.trim();
  if (!/^https?:\/\//i.test(root)) root = 'https://' + root;
  if (!isSafePublicUrl(root)) return [];

  const homeHtml = await fetchText(root);
  if (!homeHtml) return [];

  const pages: FetchedPage[] = [{ url: root, text: htmlToText(homeHtml).slice(0, MAX_TEXT_PER_PAGE) }];

  const links = findTeamLinks(homeHtml, root);
  const fetched = await Promise.all(links.map(async link => {
    const html = await fetchText(link);
    return html ? { url: link, text: htmlToText(html).slice(0, MAX_TEXT_PER_PAGE) } : null;
  }));

  for (const page of fetched) if (page) pages.push(page);
  return pages;
}
