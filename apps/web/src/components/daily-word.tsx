"use client";
import { useEffect, useState } from "react";
type Word = { koreanText: string; scriptureReference: string };
export default function DailyWord({ date }: { date: string }) {
  const [word, setWord] = useState<Word | null>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setWord(undefined);
    setError(false);
    fetch("/api/word?date=" + date, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error();
      const body = await response.json();
      if (!controller.signal.aborted) setWord(body);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [date, attempt]);
  return <section className="word-sheet" aria-label="그날의 말씀">
    <small>{date} · 매일 말씀</small><h2>{word?.scriptureReference || "그날의 말씀"}</h2>
    {word ? <div className="word-scroll" role="region" aria-label="말씀 본문" tabIndex={0}>{word.koreanText}</div>
      : error ? <p>말씀을 불러오지 못했습니다. <button onClick={() => setAttempt(n => n+1)}>다시 시도</button></p>
      : <p>{word === null ? "이 날짜에 게시된 말씀이 없습니다." : "말씀을 불러오는 중…"}</p>}
  </section>;
}
