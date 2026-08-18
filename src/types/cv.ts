export interface Contact {
  email: string | null;
  phone: string | null;
  github: string | null;
  linkedin: string | null;
  url: string | null;
}

export interface Section {
  name: string; // canonical: 'experience' | 'education' | 'skills' | 'projects' | 'summary'
  heading: string; // raw heading text
  lines: string[];
}

export interface SkillMatch {
  skill: string; // canonical name
  occurrences: number;
  firstPosition: number; // char offset in raw text
}

/**
 * Output of the deterministic (non-AI) parse step.
 */
export interface ParsedCV {
  rawText: string;
  contacts: Contact;
  sections: Section[];
  skills: SkillMatch[];
  estimatedYearsExperience: number | null;
  targetRole: string | null;
}

/**
 * Persisted CV profile (without raw bytes).
 */
export interface CVProfile extends ParsedCV {
  id: string;
  filename: string;
  contentType: string;
  embeddingStatus: "pending" | "embedded" | "failed";
  createdAt: Date;
  updatedAt: Date;
}
