"use client";
import { useEffect, useState } from "react";
type Word = { koreanText: string; englishText: string | null; scriptureReference: string };
export default function DailyWord({ date }: { date: string }) {
  const [word, setWord] = useState<Word | null>();
  const [language, setLanguage] = useState<"ko" | "en">("ko");
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
  const englishText = word?.englishText?.trim();
  const showEnglish = language === "en" && Boolean(englishText);
  return <section className="word-sheet" aria-label="그날의 말씀">
    <small>매일 말씀{word?.scriptureReference ? ` · ${word.scriptureReference}` : ""}</small>
    <h2>{new Date(`${date}T00:00:00+09:00`).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" })}</h2>
    {englishText && <div className="word-languages" role="group" aria-label="말씀 언어">
      <button type="button" aria-pressed={!showEnglish} onClick={() => setLanguage("ko")}>한국어</button>
      <button type="button" lang="en" aria-pressed={showEnglish} onClick={() => setLanguage("en")}>English</button>
    </div>}
    {word ? <div key={language} lang={showEnglish ? "en" : "ko"} className="word-scroll" role="region" aria-label="말씀 본문" tabIndex={0}>{showEnglish ? englishText : word.koreanText}</div>
      : error ? <p>말씀을 불러오지 못했습니다. <button onClick={() => setAttempt(n => n+1)}>다시 시도</button></p>
      : <p>{word === null ? "이 날짜에 게시된 말씀이 없습니다." : "말씀을 불러오는 중…"}</p>}
  </section>;
}
