// ============================================================
// EVENT TYPES — real-world calendar categories.
// Shared by the Calendar, Home, and seed data so every screen
// renders the same icon + color for a type.
// ============================================================

// Each color clears 4.5:1 both on white and on its own soft tint (so the
// color works as an icon/dot AND as text on the chip). No violet, and no
// teal: teal is indistinguishable from the brand green at dot size.
export const EVENT_TYPES = {
  meeting:     { label: "Meeting",      emoji: "📅", color: "#2F6FB5", soft: "#EAF1F8" },
  focus:       { label: "Focus block",  emoji: "🧠", color: "#0F7A4F", soft: "#E7F2ED" },
  deadline:    { label: "Deadline",     emoji: "⏰", color: "#B0521F", soft: "#F7EEE9" },
  appointment: { label: "Appointment",  emoji: "🗓️", color: "#886838", soft: "#F3F0EB" },
  personal:    { label: "Personal",     emoji: "🌿", color: "#487832", soft: "#EDF2EB" },
  birthday:    { label: "Birthday",     emoji: "🎂", color: "#B03A5B", soft: "#F7EBEF" },
  holiday:     { label: "Holiday",      emoji: "🏖️", color: "#8A5D04", soft: "#F3EFE6" },
  travel:      { label: "Travel",       emoji: "✈️", color: "#1F6FA8", soft: "#E9F1F6" },
  workout:     { label: "Workout",      emoji: "💪", color: "#B23B34", soft: "#F7EBEB" },
  meal:        { label: "Meal",         emoji: "🍴", color: "#6F5A10", soft: "#F1EFE7" },
  class:       { label: "Class",        emoji: "📚", color: "#5A5F5B", soft: "#EFEFEF" },
  social:      { label: "Social",       emoji: "🎉", color: "#7A3A0E", soft: "#F2EBE7" },
  medical:     { label: "Medical",      emoji: "🏥", color: "#A02C2C", soft: "#F6EAEA" },
  bill:        { label: "Bill payment", emoji: "💳", color: "#4F5B6B", soft: "#EDEFF0" },
  reminder:    { label: "Reminder",     emoji: "🔔", color: "#6B5C2A", soft: "#F0EFEA" },
};

export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPES).map(([value, t]) => ({
  value,
  label: `${t.emoji}  ${t.label}`,
}));

export function typeMeta(type) {
  return EVENT_TYPES[type] || EVENT_TYPES.meeting;
}
