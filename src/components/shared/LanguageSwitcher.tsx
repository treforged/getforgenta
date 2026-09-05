import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, setLanguage } from '@/lib/i18n';

/**
 * THE ONE CONTROL THAT CHANGES THE LANGUAGE.
 *
 * It renders `SUPPORTED_LANGUAGES` rather than its own list, so a language cannot be
 * shipped in the catalogue and left unreachable in the UI — the failure this repo keeps
 * hitting, where a control exists and nothing behind it is connected.
 *
 * It appears on the SIGNED-OUT Landing page as well as in Settings on purpose: a Spanish
 * speaker who cannot read the sign-in page cannot reach a preference that lives behind it.
 */
export default function LanguageSwitcher({ className = '', id = 'language-switcher' }: { className?: string; id?: string }) {
  const { i18n } = useTranslation();

  /* `minWidth` below is not decoration. `index.css` gives every select `appearance: none`
     plus `padding-right: 2rem` for its chevron, and the browser sizes a select to its longest
     OPTION without counting that author padding — so "Español" rendered into an 80px box with
     the chevron sitting on the last letter. Measured in Chrome, not assumed: jsdom reports
     this box as 0 and would have said nothing.
     A font-size class is deliberately NOT set: `index.css:845` forces
     `font-size: 16px !important` on every input, textarea and select, because anything smaller
     makes iOS Safari zoom the page on focus. A size class here would be inert. */
  return (
    <select
      id={id}
      value={i18n.language}
      onChange={e => setLanguage(e.target.value)}
      aria-label="Language"
      className={className || 'bg-secondary border border-border px-2 py-1 text-foreground'}
      style={{ borderRadius: 'var(--radius)', minWidth: '7.5rem' }}
    >
      {SUPPORTED_LANGUAGES.map(l => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
}
