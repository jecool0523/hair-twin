export const readStoredJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeStoredJson = <T,>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};
