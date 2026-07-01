import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ResumeData } from "../src/data/resumeTypes";

const privateResumeDataPath = path.resolve(process.cwd(), "server/private/resume-data.local.json");

export class PrivateResumeDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateResumeDataError";
  }
}

export const getPrivateResumeDataPath = () => privateResumeDataPath;

export const readPrivateResumeData = () => {
  if (!existsSync(privateResumeDataPath)) {
    throw new PrivateResumeDataError("私有简历数据文件不存在，请创建 server/private/resume-data.local.json。");
  }

  try {
    return JSON.parse(readFileSync(privateResumeDataPath, "utf8")) as ResumeData;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知解析错误";
    throw new PrivateResumeDataError(`私有简历数据读取失败：${message}`);
  }
};
