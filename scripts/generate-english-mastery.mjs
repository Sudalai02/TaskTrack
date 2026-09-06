// ============================================================
// GENERATOR — English Communication Mastery plan.
//
// Produces english-mastery-plan.json in the app's import shape:
//   { goals: [], projects: [], tasks: [] }
// Import it via Settings → Privacy → Import JSON.
//
// Structure: 1 Goal → 3 Projects → 24 Weeks → 2 Tasks/week
// (16 tasks per project, 48 tasks total / ~6 months).
// ============================================================

const START = "2026-09-07"; // Monday

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const PROJECTS = [
  {
    id: "proj_eng_workplace",
    name: "💼 Workplace & Professional Communication",
    description: "Communicate confidently and effectively in an IT workplace.",
    color: "#3D5A80",
    month: 0,
    topics: [
      ["IT Job Interviews", "Daily Work Reporting"],
      ["Meetings", "Teamwork"],
      ["Brainstorming", "Giving & Receiving Feedback"],
      ["Presentations", "Explaining Technical Concepts"],
      ["Problem-Solving Discussions", "Professional Emails"],
      ["Chats & Messages", "Phone & Video Calls"],
      ["Asking for Clarification", "Handling Misunderstandings"],
      ["Negotiation & Persuasion", "Workplace Communication Final Practice"],
    ],
    descriptions: {
      "IT Job Interviews": "Watch a short mock IT interview, read common technical interview questions, write your answers as a script, speak answering out loud 3 times without reading.",
      "Daily Work Reporting": "Watch a stand-up meeting example, read a daily report template, write today's work report, speak presenting your report out loud.",
      "Meetings": "Watch a team meeting clip, read an agenda, write 3 things you would say in the meeting, speak your contribution out loud.",
      "Teamwork": "Listen to a collaboration conversation, read how teammates describe roles, write 3 ways to coordinate work with a team, speak role playing the coordination.",
      "Brainstorming": "Listen to a brainstorming session, read idea-sharing phrases, write 5 ideas in English, speak suggesting and building on ideas out loud.",
      "Giving & Receiving Feedback": "Listen to constructive feedback examples, read feedback phrases, write feedback for a colleague, speak delivering it politely out loud.",
      "Presentations": "Watch a short presentation, read presentation structure tips, write a 5-slide outline, speak your opening 1 minute out loud.",
      "Explaining Technical Concepts": "Watch someone explaining a technical topic, read a tech article, write a simplified explanation, speak explaining it to a non-technical listener.",
      "Problem-Solving Discussions": "Listen to a problem-solving discussion, read how to structure solutions, write the problem and 2 options, speak proposing a solution out loud.",
      "Professional Emails": "Watch a professional email tutorial, read 3 good email examples, write a work email, speak summarizing your email out loud.",
      "Chats & Messages": "Read a work chat exchange, learn instant-message abbreviations, write 5 short polite chat messages, speak them out loud naturally.",
      "Phone & Video Calls": "Watch a work call example, read call-opening phrases, write your call agenda, speak role playing a video call greeting and wrap-up.",
      "Asking for Clarification": "Listen to someone asking clarifying questions, read clarification phrases, write 3 questions for a task explanation, speak asking them out loud.",
      "Handling Misunderstandings": "Watch a misunderstanding unfold, read repair phrases, write how you would fix a misunderstanding, speak role playing the fix.",
      "Negotiation & Persuasion": "Listen to a negotiation, read persuasion phrases, write your position and trade-offs, speak negotiating for an outcome out loud.",
      "Workplace Communication Final Practice": "Review your weeks 1-8 notes, write a summary of what you learned, speak a 5-minute workplace conversation covering 4 topics you practiced.",
    },
  },
  {
    id: "proj_eng_social",
    name: "🗣️ Daily Life & Social Communication",
    description: "Speak naturally, build relationships, express yourself, and handle everyday social situations confidently.",
    color: "#2E7D6B",
    month: 2,
    topics: [
      ["Casual Conversations", "Small Talk"],
      ["Asking for Help", "Giving Advice"],
      ["Expressing Opinions", "Agreeing & Disagreeing Politely"],
      ["Relationships", "Making Friends"],
      ["Emotions", "Personal Experiences"],
      ["Storytelling", "Active Listening"],
      ["Apologizing", "Saying No Politely"],
      ["Setting Boundaries", "Social Communication Final Practice"],
    ],
    descriptions: {
      "Casual Conversations": "Watch two friends chatting, read casual phrases, write a casual dialogue, speak it naturally without a script.",
      "Small Talk": "Listen to small talk about weather, weekend and food, read openers, write 5 small talk questions, speak asking and reacting to them.",
      "Asking for Help": "Watch someone asking for help, read polite help phrases, write 3 requests for help, speak role playing each request.",
      "Giving Advice": "Listen to someone giving advice, read advice phrases, write advice for a friend's problem, speak giving that advice warmly.",
      "Expressing Opinions": "Watch people sharing opinions, read opinion starters, write your opinion on a familiar topic, speak sharing it for 2 minutes.",
      "Agreeing & Disagreeing Politely": "Listen to a polite disagreement, read agreement and disagreement phrases, write responses to 3 statements, speak them out loud.",
      "Relationships": "Watch a conversation about relationships, read relationship vocabulary, write about people close to you, speak describing relationships naturally.",
      "Making Friends": "Listen to people becoming friends, read icebreakers, write how you would start a new friendship, speak role playing the first conversation.",
      "Emotions": "Watch someone talking about feelings, read emotion vocabulary, write about your emotions this week, speak describing how you feel.",
      "Personal Experiences": "Listen to a personal story, read an experience narrative, write about your own recent experience, speak retelling it out loud.",
      "Storytelling": "Watch a short story being told, read story structure, write your own short story, speak telling it with a beginning, middle and end.",
      "Active Listening": "Listen to a conversation about listening, read listening responses, write 5 supportive responses, speak responding like an active listener.",
      "Apologizing": "Watch a sincere apology, read apology phrases, write an apology for a mistake, speak delivering it out loud.",
      "Saying No Politely": "Listen to polite refusals, read decline phrases, write 3 polite ways to say no, speak practicing each one.",
      "Setting Boundaries": "Watch someone setting a boundary, read boundary phrases, write your own boundary statement, speak stating it calmly and firmly.",
      "Social Communication Final Practice": "Review your weeks 1-8 notes, write a summary of your social progress, speak a 5-minute free talk using 4 topics you practiced.",
    },
  },
  {
    id: "proj_eng_realworld",
    name: "🌎 Travel, Services & Difficult Situations",
    description: "Handle practical real-world situations independently and communicate calmly when problems or unexpected situations occur.",
    color: "#B9546B",
    month: 4,
    topics: [
      ["Restaurant Dining", "Ordering Food & Drinks"],
      ["Shopping", "Making Reservations"],
      ["Asking Directions", "Transportation"],
      ["Airport Communication", "Hotel Check-In & Check-Out"],
      ["Customer Service", "Handling Travel Problems"],
      ["Complaints", "Conflict Resolution"],
      ["Emergencies", "Asking for Help in Difficult Situations"],
      ["Negotiation, Persuasion & Saying No", "Real-World Communication Final Practice"],
    ],
    descriptions: {
      "Restaurant Dining": "Watch a restaurant dining scene, read a menu, write how you would order a meal, speak role playing the full ordering exchange.",
      "Ordering Food & Drinks": "Listen to food and drink orders, read a menu with prices, write your order with questions, speak placing the order naturally.",
      "Shopping": "Watch a shopping conversation, read product descriptions, write 3 questions a shopper asks, speak role playing buying and paying.",
      "Making Reservations": "Listen to a reservation call, read booking phrases, write a reservation request, speak role playing booking over the phone.",
      "Asking Directions": "Watch someone asking for directions, read direction phrases, write how to reach a local landmark, speak asking and repeating directions.",
      "Transportation": "Listen to transport conversations, read ticketing phrases, write questions about buses and trains, speak asking for a ticket and platform.",
      "Airport Communication": "Watch airport interactions, read announcements, write questions a traveler asks, speak role playing check-in and boarding.",
      "Hotel Check-In & Check-Out": "Listen to a hotel front-desk conversation, read check-in phrases, write a check-in dialogue, speak role playing the whole exchange.",
      "Customer Service": "Watch a customer service call, read service phrases, write a service request, speak role playing calling support.",
      "Handling Travel Problems": "Listen to a travel problem story, read solution phrases, write what you would say when a trip goes wrong, speak explaining the problem out loud.",
      "Complaints": "Watch someone making a complaint, read polite complaint phrases, write a complaint about bad service, speak making it calmly out loud.",
      "Conflict Resolution": "Listen to a conflict being resolved, read de-escalation phrases, write how you would stay calm, speak role playing the resolution.",
      "Emergencies": "Watch emergency scenarios, read emergency phrases, write what you would say in a medical or safety emergency, speak practicing the phrases.",
      "Asking for Help in Difficult Situations": "Listen to someone asking for help under pressure, read help-seeking phrases, write your go-to request sentences, speak them slowly and clearly.",
      "Negotiation, Persuasion & Saying No": "Watch negotiation and refusal clips, read firm-but-polite phrases, write your lines for pushing back, speak role playing them.",
      "Real-World Communication Final Practice": "Review your weeks 1-8 notes, write a summary of real-world skills gained, speak a 5-minute conversation covering 4 situations you practiced.",
    },
  },
];

const GOAL = {
  id: "goal_english_mastery",
  title: "English Communication Mastery",
  description:
    "Build confident, natural, and practical English communication skills for professional work, daily social interactions, travel, services, and difficult or unexpected situations.",
  category: "Learning",
  priority: "High",
  status: "Active",
  startDate: START,
  targetDate: addDays(START, 181),
  milestones: [],
  createdAt: new Date().toISOString(),
};

function projectRow(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    goalId: GOAL.id,
    status: "Active",
    deadline: addDays(START, p.month * 28 + 56),
    color: p.color,
    createdAt: new Date().toISOString(),
  };
}

function taskRows() {
  const tasks = [];
  let n = 1;
  for (const p of PROJECTS) {
    p.topics.forEach((weekTopics, w) => {
      weekTopics.forEach((title, slot) => {
        // Week w (0-based) + slot offset; the working week starts at
        // month*4 weeks and each task lands 0 / 3 days into its week.
        const dueDate = addDays(START, p.month * 28 + w * 7 + slot * 3);
        tasks.push({
          id: `task_eng_${p.id.replace("proj_eng_", "")}_${w + 1}_${slot + 1}`,
          title,
          description: p.descriptions[title] || "",
          projectId: p.id,
          goalId: GOAL.id,
          status: "Todo",
          priority: "Medium",
          estimatedMinutes: 45,
          actualMinutes: null,
          dueDate,
          startTime: null,
          endTime: null,
          tags: ["English"],
          energy: "Medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
        });
        n += 1;
      });
    });
  }
  return tasks;
}

const dump = {
  goals: [GOAL],
  projects: PROJECTS.map(projectRow),
  tasks: taskRows(),
};

const out = process.argv[2] || "./english-mastery-plan.json";
const fs = await import("node:fs");
fs.writeFileSync(out, JSON.stringify(dump, null, 2) + "\n", "utf8");

console.log(`Wrote ${out}`);
console.log(`  goals:    ${dump.goals.length}`);
console.log(`  projects: ${dump.projects.length}`);
console.log(`  tasks:    ${dump.tasks.length}`);
console.log(`  span:     ${dump.goals[0].startDate} → ${dump.goals[0].targetDate}`);