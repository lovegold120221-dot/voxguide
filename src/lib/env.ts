export const getEnv = (key: string) => {
  return (import.meta as any).env?.[key] || '';
};
