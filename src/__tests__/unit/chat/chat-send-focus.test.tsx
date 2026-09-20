import type { Contact } from "@/core/types/contact";
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import ChatScreen from "@/ui/screens/Chat/ChatScreen";
import { useChatView } from "@/store/chat-view";
import type { ChatMessage } from "@/core/domain/chat";
import { encodeChatPaymentNotice } from "@/core/domain/chat-payment";

const conversation = {
  id: "chat",
  channel: "direct",
  peer: "b".repeat(64),
  draft: "",
  unread: 0,
  pinned: false,
  muted: false,
  blocked: false,
};
let messages: ChatMessage[] = [];
let contacts: Contact[] = [];
let conversationLoaded = true;
const send = vi.fn();
const markRead = vi.fn().mockResolvedValue(undefined);
const update = vi.fn().mockResolvedValue(undefined);
const remove = vi.fn().mockResolvedValue(undefined);
const registry = {
  crypto: { encodeNpub: (value: string) => `npub1${value}` },
  inputParser: {},
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@/ui/hooks/use-chat", () => ({
  useChat: () => ({
    conversations: conversationLoaded ? [conversation] : [],
    messages,
    chat: {
      send,
      enqueue: send,
      update,
      delete: remove,
      markRead,
      getSnapshot: () => ({ messages }),
    },
  }),
}));
vi.mock("@/ui/hooks/use-contacts", () => ({
  useContacts: () => ({
    contacts,
    createContact: vi.fn(),
    updateContact: vi.fn(),
  }),
}));
vi.mock("@/ui/hooks/use-service-registry", () => ({
  useServiceRegistry: () => registry,
}));
vi.mock("@/ui/screens/Contacts/ContactFormModal", () => ({
  ContactFormModal: () => null,
}));

const previousScrollTo = HTMLElement.prototype.scrollTo;
HTMLElement.prototype.scrollTo = function (
  options: ScrollToOptions | number = {}
) {
  if (typeof options !== "number")
    this.scrollTop = options.top ?? this.scrollTop;
};
const previousObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
afterAll(() => {
  globalThis.ResizeObserver = previousObserver;
  HTMLElement.prototype.scrollTo = previousScrollTo;
});
beforeEach(() => {
  useChatView.setState({ submittedRequests: {} });
  messages = [];
  contacts = [];
  conversationLoaded = true;
  conversation.draft = "";
  conversation.channel = "direct";
  conversation.unread = 0;
  markRead.mockClear();
  send.mockReset();
  remove.mockClear();
  update.mockClear();
  useChatView.getState().select("chat");
});

it.each(["stored", "session"] as const)(
  "does not reoffer a submitted request while transaction lookup is unavailable (%s)",
  (mode) => {
    const request: ChatMessage = {
      id: "request",
      conversationId: "chat",
      sender: conversation.peer,
      recipient: "a".repeat(64),
      outgoing: false,
      status: "received",
      createdAt: Date.now(),
      content: "creq-test",
    };
    messages = [request];
    if (mode === "stored")
      messages.push({
        ...request,
        id: "payment",
        outgoing: true,
        status: "sent",
        content: encodeChatPaymentNotice({
          amount: 50,
          unit: "sat",
          recipient: conversation.peer,
          transactionId: "tx-paid",
          requestMessageId: request.id,
        }),
        payment: {
          kind: "send",
          amount: 50,
          transactionId: "tx-paid",
          requestMessageId: request.id,
        },
      });
    else useChatView.getState().markSubmitted("chat", request.id);
    render(
      <ChatScreen
        onBack={vi.fn()}
        onSend={vi.fn()}
        onRequest={vi.fn()}
        onPay={vi.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: "chat.sendMoney" })
    ).not.toBeInTheDocument();
  }
);

function setup() {
  const back = vi.fn();
  render(
    <ChatScreen
      onBack={back}
      onSend={vi.fn()}
      onRequest={vi.fn()}
      onPay={vi.fn()}
    />
  );
  const input = screen.getByRole("textbox", {
    name: "chat.messagePlaceholder",
  }) as HTMLTextAreaElement;
  input.focus();
  fireEvent.change(input, { target: { value: "Hello" } });
  return {
    input,
    button: screen.getByRole("button", { name: "common.send" }),
    back,
  };
}

describe("chat send focus", () => {
  it("keeps focus through Safari touch-end and allows the next draft while publishing", async () => {
    let complete!: () => void;
    send.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const { input, button } = setup();
    fireEvent.touchStart(button);
    button.focus(); // Safari may move focus despite pointerdown.preventDefault().
    const measuredWhileFocused: boolean[] = [];
    vi.spyOn(input, "getBoundingClientRect").mockImplementation(() => {
      measuredWhileFocused.push(document.activeElement === input);
      return new DOMRect(50, 500, 200, 44);
    });
    fireEvent.touchEnd(button, {
      changedTouches: [{ clientX: 0, clientY: 0 }],
    });
    expect(input).toHaveFocus();
    expect(measuredWhileFocused).toEqual([false]);
    expect(input).toHaveValue("");
    expect(send).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { value: "Next message" } });
    await act(async () => complete());
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Next message");
  });
  it("does not send when a touch is released outside the send button", () => {
    const { button } = setup();
    fireEvent.touchStart(button);
    fireEvent.touchEnd(button, {
      changedTouches: [{ clientX: 100, clientY: 100 }],
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("requires confirmation before deleting a conversation", async () => {
    const { back } = setup();
    fireEvent.click(screen.getByRole("button", { name: "chat.actions" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "chat.deleteConversation" })
    );
    expect(remove).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "common.delete" }))
    );
    expect(remove).toHaveBeenCalledWith("chat");
    expect(back).toHaveBeenCalledOnce();
  });
});

describe("unsaved message recovery", () => {
  it("preserves the next draft and offers the original message for retry", async () => {
    let reject!: (error: Error) => void;
    send.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        })
    );
    const { input, button } = setup();
    fireEvent.click(button);
    fireEvent.change(input, { target: { value: "Next draft" } });
    await act(async () => reject(new Error("Storage unavailable")));
    expect(input).toHaveValue("Next draft");
    expect(screen.getByText("Hello")).toBeInTheDocument();
    send.mockResolvedValueOnce(undefined);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "common.retry" }))
    );
    expect(send).toHaveBeenLastCalledWith("chat", "Hello");
    expect(input).toHaveValue("Next draft");
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("restores the original message when the composer is still empty", async () => {
    send.mockRejectedValueOnce(new Error("Storage unavailable"));
    const { input, button } = setup();
    await act(async () => fireEvent.click(button));
    expect(input).toHaveValue("Hello");
    expect(
      screen.queryByRole("button", { name: "common.retry" })
    ).not.toBeInTheDocument();
  });
});

function historyMessage(index: number): ChatMessage {
  return {
    id: `history-${index}`,
    conversationId: "chat",
    sender: conversation.peer,
    recipient: "a".repeat(64),
    content: `Message ${index}`,
    outgoing: false,
    status: "received",
    createdAt: 1000 + index,
  };
}

it("retains the visible history prefix when a new message arrives", () => {
  messages = Array.from({ length: 100 }, (_, index) => historyMessage(index));
  const element = () => (
    <ChatScreen
      onBack={vi.fn()}
      onSend={vi.fn()}
      onRequest={vi.fn()}
      onPay={vi.fn()}
    />
  );
  const view = render(element());
  const log = screen.getByRole("log");
  Object.defineProperty(log, "scrollHeight", { value: 4000 });
  Object.defineProperty(log, "clientHeight", { value: 500 });
  log.scrollTop = 120;
  fireEvent.scroll(log);
  expect(screen.getByText("Message 20")).toBeInTheDocument();
  expect(screen.queryByText("Message 19")).not.toBeInTheDocument();
  messages = [...messages, historyMessage(100)];
  view.rerender(element());
  expect(screen.getByText("Message 20")).toBeInTheDocument();
  expect(screen.getByText("Message 100")).toBeInTheDocument();
  expect(log.scrollTop).toBe(120);
});

it("preserves the reading position when older history is revealed", () => {
  messages = Array.from({ length: 100 }, (_, index) => historyMessage(index));
  render(
    <ChatScreen
      onBack={vi.fn()}
      onSend={vi.fn()}
      onRequest={vi.fn()}
      onPay={vi.fn()}
    />
  );
  const log = screen.getByRole("log");
  Object.defineProperty(log, "scrollHeight", {
    get: () => log.querySelectorAll("[data-chat-metadata]").length * 50,
  });
  Object.defineProperty(log, "clientHeight", { value: 500 });
  log.scrollTop = 120;
  fireEvent.scroll(log);
  fireEvent.click(screen.getByRole("button", { name: "chat.older" }));
  expect(screen.getByText("Message 0")).toBeInTheDocument();
  expect(log.scrollTop).toBe(1120);
});

it("does not expose wallet or contact actions for a trade channel by default", () => {
  conversation.channel = "trade";
  setup();
  expect(
    screen.queryByRole("button", { name: "chat.paymentActions" })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "chat.actions" }));
  expect(
    screen.queryByRole("menuitem", { name: "contacts.addContact" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "chat.deleteConversation" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "chat.block" })
  ).not.toBeInTheDocument();
});

it("keeps queued messages pending beyond thirty seconds", () => {
  messages = [{ ...historyMessage(0), outgoing: true, status: "sending" }];
  setup();
  expect(screen.getByLabelText("chat.sending")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "common.retry" })
  ).not.toBeInTheDocument();
});

it.each(["touchEnd", "touchCancel"] as const)(
  "marks messages read on %s when a drag stops at the bottom without momentum",
  (endEvent) => {
    setup();
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { value: 4000 });
    Object.defineProperty(log, "clientHeight", { value: 500 });
    conversation.unread = 1;
    markRead.mockClear();
    fireEvent.touchStart(log);
    log.scrollTop = 3500;
    fireEvent.scroll(log);
    expect(markRead).not.toHaveBeenCalled();
    fireEvent[endEvent](log);
    expect(markRead).toHaveBeenCalledWith("chat");
  }
);

it("hydrates a persisted draft after the conversation snapshot loads", () => {
  conversationLoaded = false;
  conversation.draft = "Saved before locking";
  const element = () => (
    <ChatScreen
      onBack={vi.fn()}
      onSend={vi.fn()}
      onRequest={vi.fn()}
      onPay={vi.fn()}
    />
  );
  const view = render(element());
  expect(update).not.toHaveBeenCalled();
  conversationLoaded = true;
  view.rerender(element());
  expect(
    screen.getByRole("textbox", { name: "chat.messagePlaceholder" })
  ).toHaveValue("Saved before locking");
  view.unmount();
  expect(update).toHaveBeenLastCalledWith("chat", {
    draft: "Saved before locking",
  });
  expect(update).not.toHaveBeenCalledWith("chat", { draft: "" });
});

it("uses the shared peer identity for payment without a saved contact", async () => {
  const onSend = vi.fn();
  render(
    <ChatScreen
      onBack={vi.fn()}
      onSend={onSend}
      onRequest={vi.fn()}
      onPay={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "chat.paymentActions" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "chat.sendMoney" }))
  );
  expect(onSend).toHaveBeenCalledWith(
    expect.stringMatching(/^npub1/),
    expect.any(String)
  );
});

it("uses the shared contact identity for chat and payment", async () => {
  contacts = [
    {
      id: "peer",
      name: "Alice",
      address: conversation.peer,
      addressType: "npub",
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const onSend = vi.fn();
  render(
    <ChatScreen
      onBack={vi.fn()}
      onSend={onSend}
      onRequest={vi.fn()}
      onPay={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "chat.paymentActions" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "chat.sendMoney" }))
  );
  expect(onSend).toHaveBeenCalledWith(expect.stringMatching(/^npub1/), "Alice");
});

describe("composer action focus", () => {
  const touch = { identifier: 1, clientX: 20, clientY: 20 };
  function actionsSetup() {
    const { input } = setup();
    const button = screen.getByRole("button", { name: "chat.paymentActions" });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 44, 44)
    );
    return { input, button };
  }
  it("keeps the keyboard focus and draft when opening and closing with touch", () => {
    const { input, button } = actionsSetup();
    for (const open of [true, false]) {
      fireEvent.touchStart(button, { touches: [touch] });
      button.focus();
      const event = new Event("touchend", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "changedTouches", { value: [touch] });
      fireEvent(button, event);
      expect(event.defaultPrevented).toBe(true);
      expect(input).toHaveFocus();
      expect(input).toHaveValue("Hello");
      expect(button).toHaveAttribute("aria-expanded", String(open));
      fireEvent.click(button, { detail: 1 });
      expect(button).toHaveAttribute("aria-expanded", String(open));
    }
  });
  it("cancels touches released outside the button", () => {
    const { input, button } = actionsSetup();
    fireEvent.touchStart(button, { touches: [touch] });
    fireEvent.touchEnd(button, {
      changedTouches: [{ ...touch, clientX: 100 }],
    });
    fireEvent.click(button, { detail: 1 });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveFocus();
  });
  it("cancels interrupted touches without toggling", () => {
    const { button } = actionsSetup();
    fireEvent.touchStart(button, { touches: [touch] });
    fireEvent.touchCancel(button);
    fireEvent.touchEnd(button, { changedTouches: [touch] });
    fireEvent.click(button, { detail: 1 });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
  it("does not summon the keyboard when the composer is not focused", () => {
    const { input, button } = actionsSetup();
    input.blur();
    fireEvent.touchStart(button, { touches: [touch] });
    fireEvent.touchEnd(button, { changedTouches: [touch] });
    fireEvent.click(button, { detail: 1 });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(input).not.toHaveFocus();
  });
  it("keeps mouse focus and supports keyboard activation and Escape", () => {
    const { input, button } = actionsSetup();
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button, { detail: 1 });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    button.focus();
    fireEvent.click(button, { detail: 0 });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveFocus();
  });
});
