import type { PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";
import { type RuntimeRequestId, type ScopedThreadRef } from "@t3tools/contracts";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { memo, use, useEffect, useEffectEvent, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { isInSideChatPane } from "~/lib/sideChatPane";
import { cn } from "~/lib/utils";
import { markdownProseDirection, textDirection } from "~/textDirection";

import { derivePendingUserInputProgress } from "../../pendingUserInput";
import { type PendingUserInput } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CheckboxMark } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Spinner } from "../ui/spinner";
import { BackgroundThreadContext } from "./backgroundThread";
import { DIGIT_SHORTCUTS_ATTRIBUTE } from "./composerFocusRedirect";

/** What the conversation needs to show and answer the question the agent is waiting on. */
export interface TimelineQuestion {
  readonly prompt: PendingUserInput;
  readonly disabled: boolean;
  readonly isResponding: boolean;
  readonly answers: Record<string, PendingUserInputDraftAnswer>;
  readonly questionIndex: number;
  readonly onToggleOption: (questionId: string, optionValue: string) => void;
  readonly onChangeCustomAnswer: (questionId: string, value: string) => void;
  /** Moves to the next question, or sends the answers from the last one. */
  readonly onAdvance: () => void;
  readonly onPrevious: () => void;
  readonly onDismiss: (requestId: RuntimeRequestId) => void;
}

/**
 * The agent's question, in the conversation: one question at a time with its options, a field
 * for an answer of the person's own, and Back / Next / Submit. What is typed in the message box
 * while it waits is the same typed answer.
 */
export const TimelineQuestionCard = memo(function TimelineQuestionCard({
  prompt,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onChangeCustomAnswer,
  onAdvance,
  onPrevious,
  onDismiss,
  cwd,
  threadRef,
}: TimelineQuestion & {
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
}) {
  // Message-mode requests remain answerable after their provider turn ends.
  const canRespond = prompt.responseCapability !== "not_resumable";
  const responseDisabled = disabled || isResponding || !canRespond;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const advance = useStableCallback(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  // Keep question identity stable for its shortcut listener.
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  // Read before later hooks to preserve the question's compiler cache.
  const draftSelectedOptions = activeQuestion?.options.map(
    (option) =>
      !customAnswerActive && progress.selectedOptionValues.includes(option.value ?? option.label),
  );

  if (
    optimisticSingleSelect &&
    activeQuestion &&
    !activeQuestion.multiSelect &&
    (optimisticSingleSelect.questionId !== activeQuestion.id ||
      (!customAnswerActive &&
        progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)))
  ) {
    setOptimisticSingleSelect(null);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the auto-advance timer when the question changes, input is disabled, or the card unmounts
  useEffect(() => {
    const clearAutoAdvance = () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
    if (disabled || activeQuestion?.id === undefined) clearAutoAdvance();
    return clearAutoAdvance;
  }, [activeQuestion?.id, disabled]);

  const handleOptionSelection = (questionId: string, optionValue: string) => {
    if (responseDisabled) return;
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionValue);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionValue });
    onToggleOption(questionId, optionValue);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    // A single choice answers the question, so move on; the last one waits for Submit.
    if (progress.isLastQuestion) return;
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      advance();
    }, 200);
  };

  const selectOptionFromShortcut = useEffectEvent(handleOptionSelection);
  const backgroundThread = use(BackgroundThreadContext);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a document keydown listener for digit shortcuts while a question is answerable
  useEffect(() => {
    if (!activeQuestion || responseDisabled || backgroundThread) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (isInSideChatPane(target)) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const option = activeQuestion.options[digit - 1];
      if (!option) return;
      event.preventDefault();
      selectOptionFromShortcut(activeQuestion.id, option.value ?? option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, backgroundThread, responseDisabled]);

  if (!activeQuestion) {
    return null;
  }

  const promptDirection = markdownProseDirection(
    prompt.questions
      .flatMap((question) => [
        question.header,
        question.question,
        ...question.options.flatMap((option) => [option.label, option.description ?? ""]),
      ])
      .join(" "),
  );
  const questionTextAlign = promptDirection === "rtl" ? "text-right" : "text-left";
  const questionCount = prompt.questions.length;
  const submitLabel = isResponding
    ? "Submitting…"
    : !progress.isLastQuestion
      ? "Next"
      : questionCount > 1
        ? "Submit answers"
        : "Submit answer";
  const canSubmit =
    !responseDisabled && progress.canAdvance && (!progress.isLastQuestion || progress.isComplete);

  return (
    <section
      aria-label="The agent's question"
      dir={promptDirection}
      data-timeline-question-card={prompt.requestId}
      {...(responseDisabled
        ? {}
        : { [DIGIT_SHORTCUTS_ATTRIBUTE]: Math.min(activeQuestion.options.length, 9) })}
      className="rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">Question</Badge>
          <h3
            className="truncate font-medium text-foreground text-sm"
            dir={textDirection(activeQuestion.header)}
          >
            {activeQuestion.header}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {questionCount > 1 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {progress.questionIndex + 1} of {questionCount}
            </span>
          ) : null}
          {prompt.dismissible ? (
            <Button
              aria-label="Dismiss question without answering"
              title="Dismiss question without answering"
              disabled={isResponding}
              size="icon-xs"
              variant="ghost"
              onClick={() => onDismiss(prompt.requestId)}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      </div>

      <ChatMarkdown
        text={activeQuestion.question}
        cwd={cwd}
        threadRef={threadRef}
        className={cn("mt-3 text-foreground", questionTextAlign)}
      />

      <div className="mt-3 flex flex-col gap-0.5">
        {activeQuestion.options.map((option, index) => {
          const optionValue = option.value ?? option.label;
          const isSelected =
            (optimisticSingleSelect?.questionId === activeQuestion.id &&
              optimisticSingleSelect.optionValue === optionValue) ||
            draftSelectedOptions?.[index] === true;
          // The preview sits outside the button: it can hold links, and a click on a single-select option advances.
          return (
            <div key={`${activeQuestion.id}:${optionValue}`}>
              <button
                type="button"
                aria-pressed={isSelected}
                disabled={responseDisabled}
                onClick={() => handleOptionSelection(activeQuestion.id, optionValue)}
                className={cn(
                  questionTextAlign,
                  "group flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-primary/25 focus-visible:ring-inset",
                  isSelected
                    ? "border-border bg-muted/50 text-foreground"
                    : "text-foreground/80 hover:bg-muted/30",
                  responseDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                )}
              >
                {/* The h-5 slots match the label's line box, so the mark and shortcut stay on its first line. */}
                <span className="pointer-events-none flex h-5 shrink-0 items-center">
                  {activeQuestion.multiSelect ? (
                    <CheckboxMark checked={isSelected} variant="contrast" />
                  ) : (
                    <OptionRadio checked={isSelected} />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium text-sm" dir={textDirection(option.label)}>
                    {option.label}
                  </span>
                  {option.description && option.description !== option.label ? (
                    <span
                      className="text-secondary-label text-xs"
                      dir={textDirection(option.description)}
                    >
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {index < 9 ? (
                  <span className="flex h-5 shrink-0 items-center">
                    <Kbd>{index + 1}</Kbd>
                  </span>
                ) : null}
              </button>
              {option.preview ? (
                <ChatMarkdown
                  text={option.preview}
                  cwd={cwd}
                  threadRef={threadRef}
                  lineBreaks
                  className="ps-9 pe-2.5 pb-1.5 text-xs text-foreground/70"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {activeQuestion.allowCustomAnswer === false ? null : (
        <div className="mt-2 px-2.5">
          <Input
            aria-label="Your own answer"
            disabled={responseDisabled}
            placeholder={
              activeQuestion.options.length > 0 ? "Other: type your own answer" : "Type your answer"
            }
            size="sm"
            value={progress.customAnswer}
            onChange={(event) => onChangeCustomAnswer(activeQuestion.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing || !canSubmit) return;
              event.preventDefault();
              onAdvance();
            }}
          />
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-1.5">
        {progress.questionIndex > 0 ? (
          <Button disabled={isResponding} size="sm" variant="ghost" onClick={onPrevious}>
            <ArrowLeftIcon />
            Back
          </Button>
        ) : null}
        <Button disabled={!canSubmit} size="sm" onClick={onAdvance}>
          {isResponding ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </div>
    </section>
  );
});

// Drawn with ui/radio-group's look instead of using its Radio: Radio only checks inside a
// RadioGroup, whose arrow keys select options and would trip the single-select auto-advance.
function OptionRadio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-foreground/55 bg-background not-dark:bg-clip-padding sm:size-4 dark:bg-input/32",
        checked ? "shadow-none" : "shadow-xs/5",
      )}
    >
      {checked ? (
        <span className="-inset-px absolute flex items-center justify-center rounded-full bg-primary before:size-2 before:rounded-full before:bg-primary-foreground sm:before:size-1.5" />
      ) : null}
    </span>
  );
}
