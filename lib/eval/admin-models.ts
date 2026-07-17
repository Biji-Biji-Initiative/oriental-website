export const DEFAULT_EVAL_JUDGE_MODEL = "gpt-4o-mini";

/** Deliberately small: every selectable judge is a reviewed cost/quality cell. */
export const ADMIN_EVAL_MODEL_CHOICES = ["gpt-5.6-luna", DEFAULT_EVAL_JUDGE_MODEL] as const;

export type AdminEvalModel = (typeof ADMIN_EVAL_MODEL_CHOICES)[number];

export function isAllowedAdminEvalModel(model: string): model is AdminEvalModel {
  return ADMIN_EVAL_MODEL_CHOICES.includes(model as AdminEvalModel);
}
