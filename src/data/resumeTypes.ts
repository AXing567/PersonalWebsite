export type Capability = {
  title: string;
  summary: string;
  points: string[];
  level: number;
};

export type Project = {
  name: string;
  subtitle: string;
  period: string;
  role: string;
  result: string;
  stack: string[];
  highlights: string[];
};

export type TimelineItem = {
  period: string;
  title: string;
  organization: string;
  details: string[];
};

export type DatedItem = {
  date: string;
  text: string;
};

export type PublicProfile = {
  englishName: string;
  name: string;
};

export type ResumeProfile = PublicProfile & {
  company: string;
  current: string;
  email: string;
  heroSummary: string;
  intent: string;
  location: string;
  phone: string;
  shortPitch: string;
  title: string;
};

export type ResumeData = {
  capabilities: Capability[];
  education: TimelineItem[];
  educationHonors: DatedItem[];
  experience: TimelineItem[];
  featuredProjects: Project[];
  metrics: Array<{
    label: string;
    value: string;
  }>;
  otherProjects: string[];
  profile: ResumeProfile;
  skillGroups: Array<{
    title: string;
    items: string[];
  }>;
  softStrengths: string[];
  typingRoles: string[];
};
