import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { HandoffPanel } from "@/components/voice-agent/HandoffPanel";
import { getSegment } from "@/lib/segments";
import { type CapturedLead, emptyCapturedLead } from "@/lib/voice/realtime-events";

function Subject() {
  const form = useForm<CapturedLead>({ defaultValues: emptyCapturedLead });
  return (
    <HandoffPanel
      captured={emptyCapturedLead}
      form={form}
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      ready={false}
      selectedSegment={getSegment("other")}
      submitted={false}
      submitting={false}
      transcript={[]}
    />
  );
}

describe("HandoffPanel", () => {
  it("keeps voice as the primary path and reserves email for sending", () => {
    render(<Subject />);

    expect(screen.getByText("Talk with Reka")).toBeVisible();
    expect(screen.getByText(/Just speak naturally\. Reka captures details as you talk/i)).toBeVisible();
    expect(screen.getByText("Talk first")).toBeVisible();
    expect(screen.getByRole("button", { name: "Email needed to send" })).toBeDisabled();
    expect(screen.queryByText("Email needed")).not.toBeInTheDocument();
  });
});
