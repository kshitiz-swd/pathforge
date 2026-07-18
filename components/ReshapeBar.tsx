"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type ReshapeBarProps = {
  onSubmit: (knowledge: string) => Promise<void>;
};

export function ReshapeBar({ onSubmit }: ReshapeBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    }
  }, [isExpanded]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKnowledge = knowledge.trim();

    if (!trimmedKnowledge || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(trimmedKnowledge);
      setKnowledge("");
      setIsExpanded(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The map could not be redrawn.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="reshape-control">
      {isExpanded ? (
        <form className="reshape-bar" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="reshape-bar__input"
            value={knowledge}
            onChange={(event) => setKnowledge(event.target.value)}
            placeholder="Tell the map what you already know…"
            aria-label="Existing knowledge"
            disabled={isSubmitting}
          />
          <button
            type="submit"
            className="reshape-bar__submit"
            disabled={isSubmitting || !knowledge.trim()}
          >
            redraw
          </button>
          <button
            type="button"
            className="reshape-bar__close"
            onClick={() => {
              setError(null);
              setIsExpanded(false);
            }}
            aria-label="Collapse existing knowledge input"
          >
            ×
          </button>
          {error ? <p className="reshape-bar__error">{error}</p> : null}
        </form>
      ) : (
        <button
          type="button"
          className="reshape-control__pill"
          onClick={() => {
            setError(null);
            setIsExpanded(true);
          }}
        >
          I already know things
        </button>
      )}
    </div>
  );
}
