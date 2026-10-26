// Project tabs in the editor (like Animate's document tabs). The list lives in this browser,
// so the tabs survive a refresh; closing a tab never deletes the project.

export type OpenProjectTab = { id: string; title: string };

const KEY = "cb-open-projects";

export const readOpenProjects = (): OpenProjectTab[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((tab) => tab && typeof tab.id === "string").map((tab) => ({ id: tab.id, title: String(tab.title || "Untitled") })) : [];
  } catch {
    return [];
  }
};

export const writeOpenProjects = (tabs: OpenProjectTab[]) => {
  try { window.localStorage.setItem(KEY, JSON.stringify(tabs)); } catch { /* tabs just won't persist */ }
};

/** Add the project (or refresh its title) and return the new list. */
export const upsertOpenProject = (tab: OpenProjectTab): OpenProjectTab[] => {
  const tabs = readOpenProjects();
  const index = tabs.findIndex((item) => item.id === tab.id);
  const next = index >= 0 ? tabs.map((item, i) => (i === index ? tab : item)) : [...tabs, tab];
  writeOpenProjects(next);
  return next;
};

export const removeOpenProject = (id: string): OpenProjectTab[] => {
  const next = readOpenProjects().filter((tab) => tab.id !== id);
  writeOpenProjects(next);
  return next;
};

// "Clear recent" only hides projects from the Recent lists (home page and editor): it stores
// the time of the clear, and a project shows up again once it is edited after that.
const RECENT_CLEARED_KEY = "cb-recent-cleared-at";

const recentClearedAt = () => {
  try { return Date.parse(window.localStorage.getItem(RECENT_CLEARED_KEY) || "") || 0; } catch { return 0; }
};

export const clearRecentProjects = () => {
  try { window.localStorage.setItem(RECENT_CLEARED_KEY, new Date().toISOString()); } catch { /* list just stays */ }
};

/** The most recently edited projects, newest first, skipping ones edited before the last clear. */
export const recentProjectsOf = <T extends { id: string; updated_at: string }>(projects: T[], limit = 5, excludeId?: string): T[] => {
  const clearedAt = recentClearedAt();
  return projects
    .filter((project) => project.id !== excludeId && Date.parse(project.updated_at) > clearedAt)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
};
