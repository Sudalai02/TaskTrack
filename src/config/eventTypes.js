// ============================================================
// EVENT TYPES — real-world calendar categories.
// Shared by the Calendar, Home, and seed data so every screen
// renders the same icon + color for a type.
// ============================================================

export const EVENT_TYPES = {
  meeting:     { label: "Meeting",      emoji: "📅", color: "#3D5A80", soft: "#EAF0F6" },
  focus:       { label: "Focus block",  emoji: "🧠", color: "#5E548E", soft: "#EEEBF5" },
  deadline:    { label: "Deadline",     emoji: "⏰", color: "#C4622D", soft: "#FBEEE5" },
  appointment: { label: "Appointment",  emoji: "🗓️", color: "#2E7D6B", soft: "#E4F3EF" },
  personal:    { label: "Personal",     emoji: "🌿", color: "#4C7A3F", soft: "#EAF4E5" },
  birthday:    { label: "Birthday",     emoji: "🎂", color: "#B85C8E", soft: "#F7E9F1" },
  holiday:     { label: "Holiday",      emoji: "🏖️", color: "#2B8CA6", soft: "#E3F2F6" },
  travel:      { label: "Travel",       emoji: "✈️", color: "#366FA8", soft: "#E6EFF7" },
  workout:     { label: "Workout",      emoji: "💪", color: "#C4423F", soft: "#FBE9E8" },
  meal:        { label: "Meal",         emoji: "🍴", color: "#B8842E", soft: "#FBF2E1" },
  class:       { label: "Class",        emoji: "📚", color: "#6B6862", soft: "#EEEEEC" },
  social:      { label: "Social",       emoji: "🎉", color: "#8E5AA8", soft: "#F1E9F6" },
  medical:     { label: "Medical",      emoji: "🏥", color: "#B23B34", soft: "#FBEAE8" },
  bill:        { label: "Bill payment", emoji: "💳", color: "#7A6448", soft: "#F2EDE4" },
  reminder:    { label: "Reminder",     emoji: "🔔", color: "#986B00", soft: "#F7F0DC" },
};

export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPES).map(([value, t]) => ({
  value,
  label: `${t.emoji}  ${t.label}`,
}));

export function typeMeta(type) {
  return EVENT_TYPES[type] || EVENT_TYPES.meeting;
}
