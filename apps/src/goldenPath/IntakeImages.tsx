/**
 * 用户这次上传的图片缩略图。只在本次调查里有（图片不进历史记录），历史回看时不显示。
 */
import type { CaseImage } from "../lib/caseIntake";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";

export function IntakeImages({ images }: { images?: CaseImage[] | null }) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  if (!images?.length) return null;
  return (
    <div className="gp-intake-images" data-gp-intake-images>
      {images.map((image) => (
        <img key={image.id} src={image.dataUrl} alt={copy.uploadedImageAlt} />
      ))}
    </div>
  );
}
