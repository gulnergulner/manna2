"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Sermon } from "@/lib/catalog";
import {
  readResume,
  resumePosition,
  saveResume,
  savedPosition,
  type Resume,
} from "@/lib/playback";
type Item = Omit<Sermon, "objectKey">;
type Status = {
  serviceDate: string;
  state: "ready" | "waiting" | "empty" | "failed";
  lastCheckedAt?: string;
  lastPublishedAt?: string;
};
function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function when(value?: string) {
  return value
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "기록 없음";
}
function todayKST() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
}
export default function Library() {
  const [items, setItems] = useState<Item[]>([]),
    [status, setStatus] = useState<Status>(),
    [mock, setMock] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(""),
    [date, setDate] = useState(""),
    [current, setCurrent] = useState<Item>(),
    [resume, setResume] = useState<Resume>(),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [jump, setJump] = useState(""),
    [stored, setStored] = useState<string[]>([]),
    [saving, setSaving] = useState(""),
    [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement>(null),
    expires = useRef(0),
    active = useRef<Item | undefined>(undefined),
    lastSaved = useRef(0),
    requestSeq = useRef(0),
    refreshing = useRef(false),
    mediaFailures = useRef(0);
  const blobUrl = useRef("");
  const cacheName = "manna-audio-v1";
  const cacheKey = (id: string) => "/saved-audio/" + encodeURIComponent(id);
  useEffect(() => {
    if (window.caches) void caches.open(cacheName).then(c => c.keys()).then(keys =>
      setStored(keys.map(k => new URL(k.url).pathname.split("/").pop()!))).catch(() => {});
    return () => URL.revokeObjectURL(blobUrl.current);
  }, []);
  async function toggleSave(item: Item) {
    setSaving(item.id);
    try {
      const cache = await caches.open(cacheName);
      if (stored.includes(item.id)) {
        await cache.delete(cacheKey(item.id));
        setStored(ids => ids.filter(id => id !== item.id));
      } else {
        await navigator.serviceWorker.register("/manna-sw.js");
        await navigator.serviceWorker.ready;
        const link = await fetch(`/api/sermons/${item.id}/play-url`);
        if (!link.ok) throw Error();
        const response = await fetch((await link.json()).url);
        if (response.status !== 200 || !response.headers.get("Content-Type")?.startsWith("audio/")) throw Error();
        await cache.put(cacheKey(item.id), new Response(response.body, { headers: {
          "Content-Type": "audio/mpeg", "X-Manna-Title": encodeURIComponent(item.title),
        }}));
        setStored(ids => [...ids, item.id]);
      }
    } catch { setError("기기 저장을 완료하지 못했습니다. 연결과 저장 공간을 확인해 주세요."); }
    finally { setSaving(""); }
  }
  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        fetch("/api/sermons"),
        fetch("/api/status"),
      ]);
      if (r.status === 401) {
        location.reload();
        return;
      }
      if (!r.ok) throw new Error("목록을 불러오지 못했습니다.");
      const data = await r.json();
      setItems(data.items);
      setMock(data.mock);
      if (s.ok) setStatus(await s.json());
      else setStatus(undefined);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setResume(readResume());
    void load();
    const id = setInterval(() => void load(), 60000);
    return () => clearInterval(id);
  }, [load]);
  const open = useCallback(
    async (item: Item, offset: number, autoplay = true) => {
      const seq = ++requestSeq.current;
      setBusy(true);
      setError("");
      try {
        const saved = window.caches && await caches.match(cacheKey(item.id), {cacheName});
        let url: string, until: number;
        if (saved) {
          const blob = await saved.blob();
          if (seq !== requestSeq.current) return;
          url = URL.createObjectURL(blob);
          until = Infinity;
        } else {
          const r = await fetch(`/api/sermons/${encodeURIComponent(item.id)}/play-url`);
          if (r.status === 401) { location.reload(); return; }
          if (!r.ok) throw new Error("음원을 열 수 없습니다.");
          const data = await r.json();
          if (seq !== requestSeq.current) return;
          url = data.url;
          until = Date.parse(data.expiresAt);
        }
        const el = audio.current!;
        active.current = item;
        setCurrent(item);
        expires.current = until;
        el.pause();
        URL.revokeObjectURL(blobUrl.current);
        blobUrl.current = saved ? url : "";
        el.src = url;
        el.onloadedmetadata = () => {
          el.currentTime = resumePosition(offset, el.duration);
          if (autoplay)
            void el
              .play()
              .catch(() => setError("재생 버튼을 눌러 시작해 주세요."));
        };
        el.load();
        setPosition(offset);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    [],
  );
  const renew = useCallback(
    async (force = false) => {
      const el = audio.current,
        item = active.current;
      if (
        !el ||
        !item ||
        refreshing.current ||
        (!force && expires.current > Date.now() + 60000)
      )
        return;
      refreshing.current = true;
      try {
        await open(item, el.currentTime, !el.paused);
      } finally {
        refreshing.current = false;
      }
    },
    [open],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (audio.current && !audio.current.paused) void renew();
    }, 30000);
    const visibility = () => {
      if (!document.hidden) void renew();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [renew]);
  useEffect(() => {
    const save = () => {
      if (active.current && audio.current)
        saveResume(active.current.id, audio.current.currentTime);
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  function choose(item: Item) {
    if (active.current && audio.current)
      saveResume(active.current.id, audio.current.currentTime);
    mediaFailures.current = 0;
    void open(item, savedPosition(item.id));
  }
  const today = todayKST(),
    todays = items.filter((i) => i.serviceDate === today),
    last = items.find((i) => i.id === resume?.id),
    visible = items.filter(
      (i) =>
        i.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (!date || i.serviceDate === date),
    );
  const todayState = loading
    ? "확인 중"
    : todays.length
      ? "청취 가능"
      : status?.serviceDate === today
        ? {
            ready: "준비 중",
            waiting: "준비 중",
            empty: "방송 없음",
            failed: "수집 실패",
          }[status.state]
        : "상태 미확인";
  return (
    <div className="shell">
      <header>
        <a className="brand" href="/">
          ☀ <strong>만나</strong>
          <span>새벽을 듣다</span>
        </a>
        <button
          className="text-button"
          onClick={async () => {
            if (window.caches) await caches.delete(cacheName);
            await fetch("/api/auth", { method: "DELETE" });
            location.reload();
          }}
        >
          로그아웃 ↗
        </button>
      </header>
      <main>
        <section className="intro">
          <span className="eyebrow">MORNING WORD, EVERY DAY</span>
          <h1>
            말씀으로 여는
            <br />
            <em>고요한 아침.</em>
          </h1>
          <p>새가나안교회 새벽예배 · 전체 예배 음성</p>
          <div className="intro-mark" aria-hidden="true">
            ☀
          </div>
        </section>
        {mock && (
          <div className="notice">
            개발용 샘플 모드 · 실제 예배가 아닌 12초 테스트 음원입니다. 날짜는
            고정된 가상 데이터입니다.
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}{" "}
            <button className="text-button" onClick={() => void load()}>
              다시 확인
            </button>
          </div>
        )}
        <section className="overview">
          <div className="today">
            <div className="section-top">
              <span className="eyebrow">TODAY’S WORSHIP</span>
              <span className="badge">{todayState}</span>
            </div>
            <h2>오늘의 새벽예배</h2>
            <p>
              {new Date().toLocaleDateString("ko-KR", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </p>
            {todays.length ? (
              todays.map((item) => (
                <div key={item.id}><button
                  className="primary"
                  key={item.id}
                  onClick={() => choose(item)}
                >
                  ▶ {item.title}
                </button> <button disabled={!!saving} onClick={() => void toggleSave(item)}>{saving === item.id ? "처리 중…" : stored.includes(item.id) ? "기기 저장 삭제" : "오늘 말씀 기기에 저장"}</button></div>
              ))
            ) : (
              <p className="muted">
                {todayState === "수집 실패"
                  ? "수집 중 문제가 발생했습니다. 다음 확인을 기다려 주세요."
                  : todayState === "방송 없음"
                    ? "오늘의 수집 범위에 해당하는 방송이 없습니다."
                    : "오늘 준비된 음원이 아직 없습니다."}
                <br />
                아래 보관함에서 이전 예배를 들을 수 있습니다.
              </p>
            )}
          </div>
          <div className="collection">
            <span className="eyebrow">COLLECTION STATUS</span>
            <h3>아침을 준비하고 있어요</h3>
            <dl>
              <div>
                <dt>마지막 수집 확인</dt>
                <dd>{when(status?.lastCheckedAt)}</dd>
              </div>
              <div>
                <dt>최근 게시 완료</dt>
                <dd>{when(status?.lastPublishedAt)}</dd>
              </div>
            </dl>
            <small>매일 06:30 확인 · 한국 시간 기준</small>
          </div>
        </section>
        {last && resume && (
          <button
            className="resume"
            onClick={() => void open(last, resume.position)}
          >
            <span>↻ 마지막 듣던 예배</span>
            <strong>{last.title}</strong>
            <span>{clock(resume.position)}부터 이어 듣기 →</span>
          </button>
        )}
        <section className="archive">
          <div className="archive-head">
            <div>
              <span className="eyebrow">YOUR DAILY MANNA</span>
              <h2>
                예배 보관함 <small>{items.length}</small>
              </h2>
            </div>
            <div className="filters">
              <input
                aria-label="제목 검색"
                placeholder="제목으로 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <input
                aria-label="예배 날짜"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              {date && (
                <button className="text-button" onClick={() => setDate("")}>
                  초기화
                </button>
              )}
            </div>
          </div>
          {loading ? (
            <p className="empty">보관함을 불러오고 있습니다…</p>
          ) : !visible.length ? (
            <p className="empty">
              {items.length
                ? "검색 조건에 맞는 예배가 없습니다."
                : "아직 게시된 예배가 없습니다."}
            </p>
          ) : (
            <div className="sermon-list">
              {visible.map((item, index) => (
                <article
                  key={item.id}
                  className={current?.id === item.id ? "selected" : ""}
                >
                  <div className="number">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="sermon-info">
                    <small>
                      {item.serviceDate.replaceAll("-", ".")} · 새벽예배
                    </small>
                    <h3>
                      <button
                        className="title-button"
                        onClick={() => choose(item)}
                      >
                        {item.title}
                      </button>
                    </h3>
                    <span className="muted">
                      전체 예배 · {clock(item.durationSeconds)} ·{" "}
                      {(item.sizeBytes / 1e6).toFixed(1)} MB
                    </span>
                  </div>
                  <button
                    className="play-circle"
                    aria-label={`${item.title} 재생`}
                    onClick={() => choose(item)}
                  >
                    ▶
                  </button>
                  {stored.includes(item.id) && item.serviceDate !== today && (
                    <button className="text-button" disabled={!!saving} onClick={() => void toggleSave(item)}>기기 저장 삭제</button>
                  )}
                  <a
                    className="download"
                    href={`/api/sermons/${item.id}/download`}
                    aria-label={`${item.title} MP3 다운로드`}
                  >
                    ↓ <span>MP3</span>
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
        <footer>
          만나 · 하루에 한 번, 말씀 곁에.
          <span>
            음원은 전체 예배입니다. 설교 구간이 별도로 분리되지 않습니다.
          </span>
        </footer>
      </main>
      <section className="player" aria-label="음원 플레이어">
        <audio
          ref={audio}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            if (active.current && audio.current)
              saveResume(active.current.id, audio.current.currentTime);
          }}
          onEnded={() => {
            if (active.current) {
              saveResume(active.current.id, 0);
              setResume(readResume());
            }
          }}
          onTimeUpdate={() => {
            const el = audio.current!;
            setPosition(el.currentTime);
            mediaFailures.current = 0;
            if (active.current && Date.now() - lastSaved.current > 5000) {
              saveResume(active.current.id, el.currentTime);
              lastSaved.current = Date.now();
            }
          }}
          onError={() => {
            if (!active.current || refreshing.current) return;
            if (mediaFailures.current++ < 1) void renew(true);
            else
              setError(
                "음원 파일을 읽지 못했습니다. 수집 상태를 확인해 주세요.",
              );
          }}
        />
        <div className="now-playing">
          <small>
            {busy
              ? "음원 준비 중…"
              : current
                ? "지금 듣는 예배"
                : "오늘도 말씀과 함께"}
          </small>
          <strong>{current?.title || "보관함에서 예배를 선택하세요"}</strong>
          {current && (
            <a href={current.sourceUrl} target="_blank" rel="noreferrer">
              원본 YouTube ↗
            </a>
          )}
        </div>
        <div className="transport">
          <div className="controls">
            <button
              disabled={!current || busy}
              aria-label="15초 뒤로"
              onClick={() => {
                audio.current!.currentTime = Math.max(
                  0,
                  audio.current!.currentTime - 15,
                );
              }}
            >
              ↶ 15
            </button>
            <button
              disabled={!current || busy}
              className="main-play"
              aria-label={playing ? "일시정지" : "재생"}
              onClick={async () => {
                const el = audio.current!;
                if (!el.paused) el.pause();
                else if (expires.current <= Date.now() + 60000)
                  await open(current!, el.currentTime);
                else
                  void el
                    .play()
                    .catch(() =>
                      setError("재생할 수 없습니다. 다시 선택해 주세요."),
                    );
              }}
            >
              {playing ? "Ⅱ" : "▶"}
            </button>
            <button
              disabled={!current || busy}
              aria-label="15초 앞으로"
              onClick={() => {
                audio.current!.currentTime = Math.min(
                  audio.current!.duration,
                  audio.current!.currentTime + 15,
                );
              }}
            >
              15 ↷
            </button>
          </div>
          <div className="seek">
            <span>{clock(position)}</span>
            <input
              aria-label="재생 위치"
              type="range"
              min="0"
              max={current?.durationSeconds || 1}
              step="0.1"
              value={position}
              disabled={!current}
              onChange={(e) => {
                audio.current!.currentTime = Number(e.target.value);
                setPosition(Number(e.target.value));
              }}
            />
            <span>{clock(current?.durationSeconds || 0)}</span>
          </div>
        </div>
        <form className="jump-time" onSubmit={e => {
          e.preventDefault();
          const match = /^(\d+):([0-5]\d)$/.exec(jump.trim());
          const el = audio.current;
          if (!match || !el || !Number.isFinite(el.duration)) return;
          el.currentTime = Math.min(el.duration, Number(match[1]) * 60 + Number(match[2]));
          setPosition(el.currentTime);
        }}>
          <button type="button" disabled={!current || busy} onClick={() => {
            const el = audio.current;
            if (el && Number.isFinite(el.duration)) el.currentTime = Math.min(el.duration, el.currentTime + 60);
          }}>준비 시간 +1분</button>
          <input aria-label="이동할 분:초" placeholder="분:초" pattern="[0-9]+:[0-5][0-9]" required value={jump} onChange={e => setJump(e.target.value)} />
          <button disabled={!current || busy}>이동</button>
        </form>
      </section>
    </div>
  );
}
