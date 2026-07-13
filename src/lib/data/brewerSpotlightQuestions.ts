// Single source of truth for the standard Brewer Spotlight question text.
// Keyed to the optional fields on the brewerSpotlights collection schema.
export const BREWER_SPOTLIGHT_QUESTIONS = [
  {
    key: "first_batch",
    question: "Tell us about your first batch of homebrew. When did you start?",
  },
  {
    key: "favorite_beer",
    question: "What's your favorite beer you've ever brewed?",
  },
  {
    key: "biggest_fail",
    question: "What about your biggest brew-fail?",
  },
  {
    key: "go_to_beer",
    question: "What's your go-to commercial beer?",
  },
  {
    key: "fermenter_now",
    question: "What's in your fermenter now?",
  },
  {
    key: "favorite_style",
    question: "What's your favorite BJCP style to brew? To drink?",
  },
  {
    key: "brewery_setup",
    question: "Tell us about your brewery. What does your set-up look like?",
  },
  {
    key: "why_homebrew",
    question: "Why do you homebrew?",
  },
  {
    key: "horsemen_highlight",
    question: "What is your favorite part of being members of the Horsemen?",
  },
  {
    key: "fun_facts",
    question: "Any other fun facts",
  },
] as const;

export type BrewerSpotlightQuestionKey =
  (typeof BREWER_SPOTLIGHT_QUESTIONS)[number]["key"];

export type BrewerSpotlightQA = { question: string; answer: string };

// Builds the ordered Q&A list for a spotlight entry: the standard questions
// (skipping any the entry didn't answer) followed by any one-off extras.
export function getBrewerSpotlightQAs(data: {
  [key: string]: unknown;
  extra_questions?: BrewerSpotlightQA[];
}): BrewerSpotlightQA[] {
  const standard = BREWER_SPOTLIGHT_QUESTIONS.filter(
    ({ key }) => typeof data[key] === "string" && data[key],
  ).map(({ key, question }) => ({
    question,
    answer: data[key] as string,
  }));

  return [...standard, ...(data.extra_questions ?? [])];
}
