// 句内 [n] 角标 + 悬停来源卡、句尾来源小标签：照抄 AI Elements InlineCitation 官方示例
// （https://ai-sdk.dev/elements/components/inline-citation：InlineCitation > InlineCitationText + InlineCitationCard > Trigger + Body > Carousel）。
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText,
} from "@/components/ai-elements/inline-citation";
import { HoverCardTrigger } from "@/components/ui/hover-card";

export type Cite = { n: number; title: string; url: string; quote: string; roleText: string };

function CiteBody({ cites }: { cites: Cite[] }) {
  return (
    <InlineCitationCardBody>
      <InlineCitationCarousel>
        <InlineCitationCarouselHeader>
          <InlineCitationCarouselPrev aria-label="上一条" />
          <InlineCitationCarouselNext aria-label="下一条" />
          <InlineCitationCarouselIndex />
        </InlineCitationCarouselHeader>
        <InlineCitationCarouselContent>
          {cites.map((cite) => (
            <InlineCitationCarouselItem key={`${cite.n}-${cite.url}`}>
              <InlineCitationSource title={`[${cite.n}] ${cite.title}`} url={cite.url} description={cite.roleText} />
              {cite.quote ? <InlineCitationQuote>{cite.quote}</InlineCitationQuote> : null}
            </InlineCitationCarouselItem>
          ))}
        </InlineCitationCarouselContent>
      </InlineCitationCarousel>
    </InlineCitationCardBody>
  );
}

/** 一句正文：句内每条依据一个 [n] 角标（悬停出来源卡），句尾一个「站点图标 + 域名 +N」小标签。 */
export function CitedSentence({ text, cites, textProps }: { text: string; cites: Cite[]; textProps?: Record<string, unknown> }) {
  return (
    <InlineCitation>
      <InlineCitationText {...textProps}>{text}</InlineCitationText>
      {cites.map((cite) => (
        <InlineCitationCard key={`sup-${cite.n}`}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              data-cite={cite.n}
              className="ml-0.5 inline-block align-super font-mono text-[10px] leading-none text-primary hover:underline"
              aria-label={`来源 ${cite.n}`}
            >
              [{cite.n}]
            </button>
          </HoverCardTrigger>
          <CiteBody cites={[cite]} />
        </InlineCitationCard>
      ))}
      {cites.length ? (
        <InlineCitationCard>
          <InlineCitationCardTrigger sources={cites.map((cite) => cite.url)} className="gap-1 align-middle font-normal" />
          <CiteBody cites={cites} />
        </InlineCitationCard>
      ) : null}
    </InlineCitation>
  );
}
