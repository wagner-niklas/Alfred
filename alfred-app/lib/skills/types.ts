// Shared type definitions for Alfred's skill system.
//
// These types are intentionally kept free of any Node.js or browser
// dependencies so they can be imported from both server-side route
// handlers and client-side React components.

/**
 * Minimal information used to show a skill in lists and menus.
 *
 * Backed by the frontmatter of a `SKILL.md` file on disk.
 */
export type SkillSummary = {
  /**
   * Filesystem-safe identifier for the skill.
   *
   * This is also used as the directory name under `mnt/skills/` and is
   * derived from the human-readable name.
   */
  slug: string;

  /** Human-readable title of the skill. */
  name: string;

  /** Short description shown in the skills sidebar. */
  description: string;
};

/**
 * Full representation of a skill, including the raw markdown content.
 */
export type SkillDetail = {
  /** Filesystem-safe slug / directory name. */
  slug: string;

  /** Optional human-readable name parsed from frontmatter. */
  name?: string;

  /** Optional short description parsed from frontmatter. */
  description?: string;

  /** Entire contents of the underlying `SKILL.md` file. */
  content: string;
};

/**
 * Request body for creating a new skill via POST /api/skills.
 */
export type CreateSkillBody = {
  /**
   * Optional custom slug. If omitted, the server may derive it from `name`.
   */
  slug?: string;

  /** Human-readable name for the new skill. */
  name?: string;

  /** Optional description; if omitted, a default is used. */
  description?: string;
};
