interface ClaimInputProps {
  claim: string;
  onClaimChange: (claim: string) => void;
  onStart: () => void;
  isDemoClaim: boolean;
}

export function ClaimInput({ claim, onClaimChange, onStart, isDemoClaim }: ClaimInputProps) {
  return (
    <section className="intro-card">
      <div className="intro-copy">
        <p className="eyebrow">Argument Checkup</p>
        <h1>把一句话说得更准</h1>
        <p>
          粘贴一个你想判断的观点，我会帮你找出它哪里说太满，并改写到证据允许的强度。
        </p>
      </div>
      <div className="input-panel">
        <label htmlFor="claim-input">输入一个观点</label>
        <textarea
          id="claim-input"
          value={claim}
          onChange={(event) => onClaimChange(event.target.value)}
          rows={4}
        />
        {!isDemoClaim ? (
          <p className="demo-note">当前 MVP 使用预置案例演示完整能力；你输入的新观点会在下一版接入实时管线。</p>
        ) : null}
        <button type="button" onClick={onStart}>开始论证体检</button>
      </div>
    </section>
  );
}
