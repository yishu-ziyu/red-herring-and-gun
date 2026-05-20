import type { ClaimDiagnosis } from "../lib/schemas";

interface DiagnosisCardProps {
  diagnosis: ClaimDiagnosis;
}

export function DiagnosisCard({ diagnosis }: DiagnosisCardProps) {
  return (
    <section className="product-card diagnosis-card">
      <div className="card-label">第一步：先别急着搜索</div>
      <div className="verdict-row">
        <div>
          <p className="verdict-kicker">诊断结果</p>
          <h2>这句话说得太满了</h2>
        </div>
        <div className="danger-word">
          <span>最危险的词</span>
          <strong>导致</strong>
        </div>
      </div>
      <p className="diagnosis-explain">{diagnosis.whyNotDirectFactCheck}</p>
      <div className="question-stack">
        <p>它至少混合了 3 个问题：</p>
        <ol>
          <li>岗位真的减少了吗？</li>
          <li>AI 是否改变了这些岗位的任务？</li>
          <li>减少是不是由 AI 导致？</li>
        </ol>
      </div>
    </section>
  );
}
