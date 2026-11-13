import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked } from 'marked';

/**
 * Markdown → sanitised HTML with LaTeX ($…$ inline, $$…$$ display) and fenced code.
 * Images may reference stored media as ![](media:ID); those are resolved by the caller.
 */
const marked = new Marked({ gfm: true, breaks: true, async: false });

marked.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start: (src: string) => src.indexOf('$$'),
      tokenizer(src: string) {
        const m = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
        return undefined;
      },
      renderer: (t) => renderTex((t as unknown as { text: string }).text, true),
    },
    {
      name: 'mathInline',
      level: 'inline',
      start: (src: string) => src.search(/\$|\\\(/),
      tokenizer(src: string) {
        const m = /^\$\$([\s\S]+?)\$\$/.exec(src) ?? /^\$((?:\\\$|[^$\n])+?)\$(?!\d)/.exec(src) ?? /^\\\(([\s\S]+?)\\\)/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: m[0].startsWith('$$') };
        return undefined;
      },
      renderer: (t) => { const x = t as unknown as { text: string; display: boolean }; return renderTex(x.text, x.display); },
    },
  ],
});

function renderTex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
  } catch {
    return `<code>${tex.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</code>`;
  }
}

let hooked = false;
function purifier() {
  if (!hooked) {
    // Every element gets dir="auto" support via CSS; links open outside the app.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    });
    hooked = true;
  }
  return DOMPurify;
}

const cache = new Map<string, string>();
export function renderMarkdown(src: string): string {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const raw = marked.parse(src) as string;
  const html = purifier().sanitize(raw, {
    ADD_ATTR: ['target', 'dir'],
    ADD_URI_SAFE_ATTR: ['src'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|media):|data:image\/(?:png|jpe?g|gif|webp);|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
  if (cache.size > 500) cache.clear();
  cache.set(src, html);
  return html;
}

/** Media IDs referenced in a text. */
export function mediaRefs(src: string): string[] {
  return [...src.matchAll(/!\[[^\]]*\]\(media:([\w-]+)\)/g)].map((m) => m[1]);
}
