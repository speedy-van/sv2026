'use client';

import { Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { RenderedFaq } from '@/server/marketing';

export function FaqSearch({ faqs }: { faqs: RenderedFaq[] }): ReactNode {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return faqs;
    return faqs.filter((faq) => `${faq.question} ${faq.answer} ${faq.category}`.toLowerCase().includes(needle));
  }, [faqs, query]);

  return (
    <div className="faq-search">
      <label className="search-field">
        <Search aria-hidden="true" size={18} />
        <span className="sr-only">Search FAQs</span>
        <input onChange={(event) => { setQuery(event.target.value); }} placeholder="Search questions" type="search" value={query} />
      </label>
      <div className="accordion-list">
        {filtered.map((faq) => (
          <details className="accordion-item" key={faq.question}>
            <summary>
              <span>{faq.question}</span>
              <small>{faq.category.replaceAll('_', ' ')}</small>
            </summary>
            <p>{faq.answer}</p>
          </details>
        ))}
        {filtered.length === 0 ? <p className="empty-note">No matching questions.</p> : null}
      </div>
    </div>
  );
}
