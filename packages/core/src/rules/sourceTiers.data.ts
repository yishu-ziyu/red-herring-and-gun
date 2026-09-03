/** A 级：政府 / 教育 / 军队后缀，以及官方辟谣平台与中央媒体 host。 */
export const TIER_A_SUFFIXES = [".gov.cn", ".edu.cn", ".mil.cn"] as const;

export const TIER_A_HOSTS = [
  "piyao.org.cn",
  "www.piyao.org.cn",
  "xinhuanet.com",
  "news.cn",
  "people.com.cn",
  "people.cn",
  "cctv.com",
  "cnr.cn",
  "chinanews.com.cn",
  "chinanews.com",
  "chinadaily.com.cn",
  "gmw.cn",
  "ce.cn",
  "www.gov.cn",
] as const;

/** B 级：省级党报与广电（≥20）、主流门户、维基。 */
export const TIER_B_HOSTS = [
  "thepaper.cn",
  "bjnews.com.cn",
  "dzwww.com",
  "zjol.com.cn",
  "southcn.com",
  "sznews.com",
  "jfdaily.com",
  "ycwb.com",
  "nbd.com.cn",
  "caixin.com",
  "yicai.com",
  "jiemian.com",
  "xhby.net",
  "dahe.cn",
  "rednet.cn",
  "fjsen.com",
  "newssc.org",
  "gxnews.com.cn",
  "cqnews.net",
  "cnhubei.com",
  "dayoo.com",
  "qianlong.com",
  "enorth.com.cn",
  "yunnan.cn",
  "hljnews.cn",
  "kankanews.com",
  "cyol.com",
  "workercn.cn",
  "stcn.com",
  "cs.com.cn",
  "sina.com.cn",
  "sohu.com",
  "163.com",
  "qq.com",
  "ifeng.com",
  "wikipedia.org",
] as const;

/** 门户后缀下的自媒体子域，必须先于 B 级门户命中。 */
export const TIER_C_OVERRIDES = [
  "mp.weixin.qq.com",
  "baijiahao.baidu.com",
  "k.sina.com.cn",
  "mp.sohu.com",
  "dy.163.com",
  "user.guancha.cn",
] as const;
