import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** 전체 문자열을 그대로 clipboard 에 복사한다 (공백/줄바꿈 제거 후, 부분 복사 방지). */
export async function copyText(value: string) {
  const text = value.replace(/\s+/g, "");
  if (!text) throw new Error("복사할 값이 없습니다.");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function CopyAddressButton({
  address,
  label = "주소 복사",
  size = "sm",
}: {
  address: string | null | undefined;
  label?: string;
  size?: "sm" | "default";
}) {
  return (
    <Button
      type="button"
      size={size}
      variant="table"
      disabled={!address}
      onClick={async () => {
        try {
          await copyText(address ?? "");
          toast.success("USDT 주소가 복사되었습니다.");
        } catch {
          toast.error("복사에 실패했습니다. 주소를 직접 선택해 복사해 주세요.");
        }
      }}
    >
      {label}
    </Button>
  );
}
