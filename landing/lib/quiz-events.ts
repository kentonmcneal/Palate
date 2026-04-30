// ============================================================================
// quiz-events.ts — typed wrappers around analytics.track() for the quiz funnel.
// ----------------------------------------------------------------------------
// Centralizing event names + payload shapes so a typo in a string can't
// silently break our funnel. Maps to the 7 events specified in the
// onboarding-quiz upgrade brief.
// ============================================================================

import { track } from "./analytics";
import type { StarterPersonaKey } from "@/config/starter-personas";

export const QuizEvents = {
  started: () => track("quiz_started"),

  questionAnswered: (params: {
    questionId: string;
    questionIndex: number;
    persona: StarterPersonaKey;
    chip: string;
  }) => track("quiz_question_answered", params),

  completed: (params: { persona: StarterPersonaKey; answeredCount: number }) =>
    track("quiz_completed", params),

  starterPalateGenerated: (params: { persona: StarterPersonaKey; chips: string[] }) =>
    track("starter_palate_generated", { ...params, chips: params.chips.join("|") }),

  saveMyPalateClicked: (params: { persona: StarterPersonaKey }) =>
    track("save_my_palate_clicked", params),

  shareCardClicked: (params: { persona: StarterPersonaKey; method: "native" | "copy" | "twitter" }) =>
    track("share_card_clicked", params),

  waitlistJoined: (params: { source: string; persona?: StarterPersonaKey }) =>
    track("waitlist_joined", params),
};
