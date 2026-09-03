export type Quota = {
  allow(ip: string): boolean;
};

export type QuotaOptions = {
  limit: number;
  now?: () => Date;
};

export function createQuota(opts: QuotaOptions): Quota {
  // ponytail: 进程内存按 IP 计日，重启清零。升级路径是账号配额。
  const byIp = new Map<string, { day: string; count: number }>();
  const now = opts.now ?? (() => new Date());

  return {
    allow(ip: string): boolean {
      if (opts.limit <= 0) return true;
      const day = now().toISOString().slice(0, 10);
      const prev = byIp.get(ip);
      if (!prev || prev.day !== day) {
        byIp.set(ip, { day, count: 1 });
        return true;
      }
      if (prev.count >= opts.limit) return false;
      prev.count += 1;
      return true;
    },
  };
}
