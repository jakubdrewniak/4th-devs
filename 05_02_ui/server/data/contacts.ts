export interface ContactContext {
  lastCall: string
  concern: string
  preferredTone: string
}

export const CONTACT_CONTEXT: Record<string, ContactContext> = {
  'enterprise-lead': {
    lastCall: 'reviewed the analytics workspace rollout',
    concern: 'wants clearer launch sequencing',
    preferredTone: 'concise and executive-friendly',
  },
  'design-partner': {
    lastCall: 'walked through the artifact preview prototype',
    concern: 'needs clearer ownership on follow-up actions',
    preferredTone: 'warm and collaborative',
  },
}
