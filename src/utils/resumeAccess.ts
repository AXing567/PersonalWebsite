import type { ResumeData } from "../data/resumeTypes";

export type ResumeAccessStatus = {
  failedAttempts: number;
  isLocked: boolean;
  isUnlocked: boolean;
  remainingAttempts: number;
  remainingLockMs: number;
  unlockedUntil?: number;
};

type ResumeAccessResponse = {
  error?: string;
  status?: ResumeAccessStatus;
};

const fallbackStatus: ResumeAccessStatus = {
  failedAttempts: 0,
  isLocked: false,
  isUnlocked: false,
  remainingAttempts: 5,
  remainingLockMs: 0,
};

const readJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
};

const readErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = await readJson<ResumeAccessResponse>(response);
    return payload.error || fallback;
  } catch {
    return fallback;
  }
};

export const getResumeAccessStatus = async () => {
  const response = await fetch("/api/resume-status", {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    return fallbackStatus;
  }

  return readJson<ResumeAccessStatus>(response);
};

export const unlockResume = async (password: string) => {
  const response = await fetch("/api/resume-unlock", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const payload = await readJson<ResumeAccessResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error || "简历解锁失败。");
  }

  return payload.status ?? fallbackStatus;
};

export const getResumeData = async () => {
  const response = await fetch("/api/resume-data", {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "请先解锁简历。"));
  }

  return readJson<ResumeData>(response);
};

export const formatResumeAccessDuration = (milliseconds: number) => {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000));
  if (minutes < 60) return `${minutes} 分钟`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分钟` : `${hours} 小时`;
};
