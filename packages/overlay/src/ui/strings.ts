/**
 * All user-visible strings for the Nova overlay.
 *
 * Every string literal used in the overlay UI must be defined here.
 * Non-ASCII characters (emojis, arrows, dashes) are intentionally
 * kept in this file; the ESLint rule `no-non-ascii-literals` is
 * disabled for this file and enabled for all other overlay source.
 */
export const strings = {
  // ── Dead click ──────────────────────────────────────────
  deadClickPrompt: 'This element does nothing. Want Nova to wire it up?',

  // ── Pill ─────────────────────────────────────────────────
  pillAriaLabel: 'Open Nova menu',
  quickEditLabel: 'Quick Edit',
  multiEditLabel: 'Multi-Edit',
  projectMapLabel: 'Project Map',
  gestureModeLabel: 'Gesture Mode',

  // ── Transcript bar ───────────────────────────────────────
  micEmoji: '\uD83C\uDFA4',
  micOffTitle: 'Voice OFF \u2014 click to enable',
  micOnTitle: 'Voice ON \u2014 click to stop',
  transcriptPlaceholder: 'Type a command or use mic...',
  listeningPlaceholder: 'Listening...',
  sendButtonTitle: 'Send command',
  sendButtonAriaLabel: 'Send command',
  sendButtonArrow: '\u27A4',
  voiceMicAriaLabel: 'Voice input',
  languageButtonTitle: 'Change language',
  autoDetectLabel: 'Auto-detect',
  confirmGo: 'Go',
  confirmSend: 'Send',
  confirmCancel: 'Cancel',
  confirmAnswerPlaceholder: 'Describe what to add...',
  confirmQuestionPlaceholder: 'Type your answer...',
  sendConfirmation: 'Send: ',

  // ── Activity log ─────────────────────────────────────────
  activityLogTitle: 'Nova Activity',
  collapseButtonTitle: 'Collapse',
  expandButtonTitle: 'Expand',
  collapseButtonAriaLabel: 'Collapse activity log',
  expandButtonAriaLabel: 'Expand activity log',
  collapseIcon: '\u2796',
  expandIcon: '\u2795',
  clickToExpand: 'Click to expand',
  clickToViewDiff: 'Click to view diff',
  thinkingEmoji: '\u{1F9E0}',
  successEmoji: '\u2705',
  errorEmoji: '\u274C',
  codeEmoji: '\u{1F4DD}',
  unreadBadge: (n: number): string => `(${n} new)`,

  // ── Diff modal ───────────────────────────────────────────
  diffCloseTitle: 'Close (Esc)',
  closeDialogAriaLabel: 'Close dialog',
  closeX: '\u2715',
  diffModified: 'Modified: ',
  diffCreated: 'Created: ',
  diffCopyButton: 'Copy diff',
  diffCopyAriaLabel: 'Copy diff to clipboard',
  diffCopied: 'Copied!',
  diffOpenFileButton: 'Open file',
  diffOpenFileAriaLabel: 'Open file in editor',
  diffRevertButton: 'Revert this file',
  diffRevertAriaLabel: 'Revert this file',
  diffReverted: 'Reverted: ',
  diffStatsAriaLabel: 'Diff statistics',

  // ── Element inspector ────────────────────────────────────
  targetEmoji: '\uD83C\uDFAF',
  inspectorQuestion: 'What do you want to do with this element?',
  inspectorPlaceholder: 'e.g. "change color to red", "make it bigger"...',
  inspectorCancel: 'Cancel',
  inspectorExecute: 'Execute',

  // ── Multi-element selector ───────────────────────────────
  multiEditTitle: 'Multi-Edit',
  multiEditHint:
    "Describe what to do. Use numbers to reference elements (e.g. 'swap 1 and 2', 'make 1 look like 3')",
  multiEditPlaceholder: 'e.g. "swap 1 and 2", "align all elements"...',
  multiEditCancel: 'Cancel',
  multiEditExecute: 'Execute',

  // ── Secret console ───────────────────────────────────────
  secretConsoleTitle: 'Environment Variables Required',
  secretConsoleDesc:
    'The generated code requires these environment variables. Enter values to save to .env.local (gitignored).',
  secretConsoleSkip: 'Skip',
  secretConsoleSave: 'Save',
  secretToggleTitle: 'Toggle visibility',
  secretToggleIcon: '\u{1F441}',
  secretPlaceholderPrefix: 'Enter ',

  // ── Task panel ───────────────────────────────────────────
  taskPanelTitle: 'Nova Tasks',
  taskPanelCloseAriaLabel: 'Close task panel',
  recentTasksLabel: 'Recent Tasks',

  // ── Suggestion panel ─────────────────────────────────────
  suggestionPanelTitle: 'Nova Suggestions',
  suggestionApprove: 'Approve',
  suggestionReject: 'Reject',

  // ── Command input ────────────────────────────────────────
  commandInputPlaceholder: 'Type a command...',

  // ── Status toast ─────────────────────────────────────────
  toastExecute: 'Execute',
  toastCancel: 'Cancel',

  // ── FSM state labels (used by status line + aria-live) ──
  stateIdle: 'Idle',
  stateListening: 'Listening',
  stateThinking: 'Thinking',
  stateApplying: 'Applying',
  stateAwaitingConfirmation: 'Awaiting confirmation',
  stateQuickEdit: 'Quick Edit active',
  stateMultiEdit: 'Multi-Edit active',
  stateGesture: 'Gesture mode',
  stateError: 'Error',

  // ── Status messages ──────────────────────────────────────
  aiThinking: '\u{1F9E0} AI is thinking\u2026 please wait',
  thinkingPhase: 'Thinking\u2026',
  generatingCodePhase: 'Generating code\u2026',
  buildFixInProgress: 'Build fix in progress \u2014 please wait...',
  fixingBuildErrors: 'Fixing build errors\u2026 please wait',
  buildFixApplied: 'Build fix applied! Reloading\u2026',
  buildFixFailed: 'Auto-fix failed. Check console for details.',
  changesReadyReload: 'Changes ready \u2014 reload pending (stop mic to apply)',
  questionEmoji: '\u{1F914}',
  allTasksCompleted: 'All tasks completed! Reloading\u2026',
  someTasksFailed: 'Some tasks failed. Check task panel.',
  confirmed: 'Confirmed!',

  // ── Mode messages ────────────────────────────────────────
  quickEditModeOn: 'Quick Edit mode \u2014 click any element (Option+I)',
  multiEditModeOn: 'Multi-Edit mode \u2014 click elements to mark them (Option+K)',
  gestureModeOn: 'Gesture Mode ON \u2014 point at elements while speaking (Option+G)',
  gestureModeOff: 'Gesture Mode OFF',

  // ── Voice feedback ───────────────────────────────────────
  voiceLanguage: 'Voice language: ',
  commandDiscarded: 'Command discarded.',
  cancelled: 'Cancelled.',
  questionDismissed: 'Question dismissed.',
  voiceToggleOn: 'Toggle voice \u2014 currently on',
  voiceToggleOff: 'Toggle voice \u2014 currently off',
  noAudioHint: 'No audio detected \u2014 check your microphone permissions or input device.',
  micPermissionDenied:
    'Microphone access denied. Please enable microphone permissions in your browser settings. See: ',
  micPermissionHelpUrl: 'https://support.google.com/chrome/answer/2693767',

  // ── Language labels ──────────────────────────────────────
  langAuto: 'Auto',
  langEN: 'EN',
  langRU: 'RU',
  langDE: 'DE',
  langFR: 'FR',
  langES: 'ES',
  langUA: 'UA',
  langJP: 'JP',
  langZH: 'ZH',
  langKO: 'KO',
  langPT: 'PT',
  langIT: 'IT',
  langPL: 'PL',
  langNL: 'NL',
  langTR: 'TR',
  langAR: 'AR',
  langHI: 'HI',

  // ── Misc ─────────────────────────────────────────────────
  sendFailed: 'Failed to send: ',
  projectAnalyzed: 'Project analyzed: ',
  awaitingConfirmation: 'Awaiting confirmation \u2014 ',
  taskCountReady: ' task(s) ready. Execute?',
  addedToRequest: 'Added to request: ',
} as const;
