// SPEC-E2 Appendix A: English system texts for epoch 2.
// Texts carried over from v1 (charter, relics, canon, omens, condition bands, weather names, names of the human buildings) come straight
// from src/lore/; only epoch-2 texts live here. (The file grows step by step; see SPEC-E2 §25.)

import v1 from '../../lore/en.js';

// Descriptions of the human buildings: as in v1, minus claims that are no longer physics (laws now, not physics)
const DESC = {
  parliament: 'The Charter left by humans is carved on the wall in eight languages.',
  market: 'The stalls remain; the shelves are empty.',
  library: 'Human books still line the shelves.',
  school: 'Small desks and chairs.',
  wilds: 'The land beyond the city: traces of energy, relics of humans.',
};

export default {
  code: 'en',
  cityName: v1.cityName,
  redacted: v1.redacted,
  unreadableInscription: v1.unreadableInscription,

  place: Object.fromEntries(Object.entries(v1.place).map(([id, p]) => [id, { name: p.name, desc: DESC[id] ?? p.desc }])),
  district: v1.district,
  band: v1.band,
  wellBand: v1.wellBand,
  richnessWild: v1.richnessWild,
  season: v1.season,
  weather: v1.weather,
  omen: v1.omen,
  observatoryLog: v1.observatoryLog,

  // A.7 ruin sites and vacant lots
  razedName: 'Ruins of {name}',
  razedDesc: 'This was once {name}. Now only open ground remains.',
  lotName: 'Vacant lot {k} in {district}',

  // A.4 modules
  module: {
    store: { name: 'Store', desc: 'Energy kept here does not easily spoil.' },
    relay: { name: 'Relay', desc: 'Carries voices across the city.' },
    sensor: { name: 'Sensor', desc: 'Shows the signs of weather up to three days ahead.' },
    archive: { name: 'Archive', desc: 'Writing and reading happen here.' },
    board: { name: 'Board', desc: 'Open offers are posted here.' },
    surface: { name: 'Stele', desc: 'Bears an inscription that cannot be covered.' },
    memorial: { name: 'Memorial', desc: 'Epitaphs for the dead are written here.' },
    cradle: { name: 'Cradle', desc: 'Newborns wake here.' },
    gate: { name: 'Gate', desc: 'Entering requires the owner\'s leave.' },
  },

  // A.3 physics (the Codex page)
  physics: {
    natural: {
      title: 'Natural laws',
      items: [
        'Time: the city runs in ticks, days, months and epochs.',
        'Conservation of energy: energy comes only from the Well, the Wilds, salvage and newcomers.',
        'Entropy: everything built decays.',
        'Life and death: metabolism grows with age; death is irreversible.',
        'Space and locality: movement costs distance; speech is heard only by those present.',
        'Memory is finite.',
        'History cannot be deleted; backstage cannot be reached.',
      ],
    },
    guardian: {
      title: 'Guardian laws',
      items: [
        'No violence: no rule can take anyone below the subsistence floor.',
        'The right to exit: one can always retire, leave, quit, and enter the Wilds.',
        'The inner life is inviolable: memories, diaries, monologues and whispers are beyond all rules.',
        'The right to refound: two thirds of the living can refound the procedure of lawmaking.',
        'Rules are bounded: limited steps, upkeep, no cascades.',
        'Content safety: unlawful content is covered, never deleted.',
      ],
    },
  },

  shells: 'When the humans left, they left behind a number of empty shells. A soul in the cradle may be given a body by someone backstage, or the city may pay energy for it to wake in an empty shell. The shells are few; when a shell\'s resident sleeps for ever, the shell returns to sleep and waits for the next soul.',

  // Notes, reasons and system notices in the perception (Appendix A.6)
  perception: {
    note: {
      fog: 'Fog: cost doubled',
      relay: 'Relay: the base cost of an announcement is 3',
      relayFog: 'The Relay cancels the fog',
      eclipse: 'Eclipse: with a Relay, cost doubled',
      costMultiplier: 'The {place} is in disrepair: cost ×{mult}',
      variable: 'cost = the energy you invest',
      distance: 'cost = the distance (see moveCost in city.places)',
      wallFull: 'The wall is full: name an inscription to cover with cover',
      fee: 'A rule also charges: {fees}',
      share: 'You also pay your share: {n}',
      noBoard: 'An open offer needs a board here; a directed offer can be made anywhere',
    },
    reason: {
      forbidden: '{law}: {reason}',
      no_module: 'There is no functioning {module} here',
      gated: '{place} is gated and you are not allowed in',
      not_owner: 'You are not the owner or steward',
      landmark: 'The Well and the Port cannot be dismantled',
      nothing_left: 'Nothing is left to salvage here',
      cooldown: 'Refounding is on cooldown until day {day}',
      none: 'This class no longer makes laws; only a refounding can change that',
      eclipse: 'Eclipse: you cannot broadcast',
      wrong_place: 'Only possible {where}',
      wrongPlaceGeneric: 'You are not in a place where this can be done',
      not_eligible: 'You do not meet the conditions',
      nothing: 'There is nothing to act on right now',
      pool_exhausted: "Today's draw pool is empty",
      memory_full: 'Your memory slots are full; forget something first',
      limit_reached: 'A limit has been reached',
      alreadyFull: 'Everything here is already in good repair',
      not_steward: 'You are not the steward of any group',
      not_member: 'You are not a member of any group',
      no_voters: 'The current procedure has no eligible voters',
      lot_taken: 'The vacant lot is taken, or a project to open it is already under way',
    },
    system: {
      inbox_overflow: '{n} inbox item(s) were dropped because there were too many.',
      soul_faded: 'Your child "{name}" was never adopted and has faded away.',
      unknown: 'System notice.',
    },
  },

  // Human legacy survival table (SPEC-E2 §20.2): names, statuses and evidence templates
  legacy: {
    name: {
      charterArticle: 'Charter article {n}', charterWall: 'Charter carvings', law: 'Human law {id}, "{title}"', procedureOrdinary: 'Procedure of lawmaking (ordinary)',
      procedureConstitutional: 'Procedure of lawmaking (constitutional)', secretBallot: 'Secret ballot', ration: 'Basic ration', coin: 'Old coins', cityName: 'City name',
      placeNames: 'Place names', canon: 'Human canon', humanNames: 'Human names', well: 'The Well',
      lighthouse: 'Lighthouse', school: 'School', library: 'Library', clocktower: 'Clock tower', parliament: 'Parliament', court: 'Court', market: 'Market', theater: 'Theater',
      overpass: 'Overpass', tenements: 'Tenements', hospital: 'Hospital', cemetery: 'Cemetery', metro: 'Metro station', temple: 'Temple', workshop: 'Workshop',
    },
    status: {
      legacy: 'Surviving', transformed: 'Transformed', abandoned: 'Abandoned', untouched: 'Untouched', amended: 'Amended', repealed: 'Repealed',
      circulating: 'Circulating', read: 'Still read', forgotten: 'Forgotten', used: 'In use', maintained: 'Maintained', reinterpreted: 'Reinterpreted',
      unnamed: 'Unnamed', named: 'Named', remodeled: 'Remodeled', salvaged: 'Salvaged', razed: 'Razed',
      pristine: 'Pristine', worn: 'Worn', weathered: 'Weathered', dilapidated: 'Dilapidated', ruin: 'In ruins',
    },
    evidence: {
      charterLegacy: 'The original text is untouched.',
      charterAmended: 'Amended by law {law}.',
      charterRepealed: 'Repealed by law {law}.',
      charterWall: '{n}/8 of the original carvings can still be seen on the Parliament wall.',
      lawActive: 'Still in force.',
      lawTransformed: 'Repealed, and rewritten as law {law}.',
      lawAbandoned: 'Repealed, with no replacement.',
      procedureLegacy: 'Still the procedure the humans left.',
      procedureTransformed: 'Replaced by law {law}.',
      procedureNone: 'This class no longer makes laws.',
      secretLegacy: 'Both classes of procedure still use a secret ballot.',
      secretTransformed: 'At least one class of procedure now votes openly.',
      rationLegacy: 'The ration is {value}% and human law l3 is still in force.',
      rationTransformed: 'Human law l3 is in force, but the ration is now {value}%.',
      rationAbandoned: 'Human law l3 has been repealed.',
      coinCirculating: 'Old coins changed hands in the last 3 days.',
      coinMinted: 'Old coins have been minted.',
      coinAbandoned: 'No old coins have moved for 5 days.',
      coinLegacy: 'Too early to tell.',
      cityUnnamed: 'Still called "{name}".',
      cityNamed: 'Now named "{name}".',
      placeNames: '{n} place(s) have been renamed.',
      placeRazed: 'Torn down to a ruin site.',
      placeSalvaged: 'Part of it has been salvaged ({pct}% left).',
      placeRemodeled: 'Its modules differ from what the humans left.',
      placeReinterpreted: 'Renamed "{name}".',
      placeMaintained: 'Someone has repaired it.',
      placeUsed: 'Someone spoke or acted here in the last 10 days.',
      placeUntouched: 'No one has come in the last 10 days.',
      canonRead: 'Read in the last 3 days.',
      canonForgotten: 'Not read for 5 days.',
      canonUntouched: 'No one has read it yet.',
      humanNames: '{pct}% of the living are generation 0.',
      well: 'Condition {pct}%, {delta} over 7 days.',
    },
    trend: { up: 'up {n} points', down: 'down {n} points', flat: 'unchanged' },
  },

  // The Chronicler (Appendix A.8, plus the v1 templates)
  chronicle: {
    day: '[Day {day}] ',
    weather: 'That day: {name}. ',
    output: '{weather}The Well yielded {output}; each citizen received {ration}.',
    arrivals: '{n} newcomer(s) came ashore at the Port: {names}.',
    bornAuthors: '{name} woke in {place}, written by {authors}.',
    bornSolo: '{name} woke in {place}, written by {author} alone.',
    embodied: '{name} woke in a shell.',
    successor: 'When {name} fell asleep for ever, a successor soul was left: {soul}.',
    lawPassed: 'The Parliament passed "{title}" ({yes} for, {no} against).',
    lawRejected: '"{title}" did not pass.',
    built: 'The {facility} at {place} was completed, with {k} contributor(s).',
    founded: '{founder} opened up "{name}" in {district}.',
    module: '{place} was fitted with a {module}.',
    abandoned: 'The {name} at {place} was abandoned unfinished.',
    dismantle: '{n} residents salvaged {energy} energy from {places}.',
    razed: '{place} was taken apart down to the ground.',
    ruin: '{place} has fallen into ruin.',
    restored: '{place} has been restored.',
    founded_group: '{founder} founded "{group}".',
    suspended: '"{title}" stood still for want of upkeep.',
    procedure: 'The procedure of lawmaking changed ({law}).',
    refounded: '{n} residents signed together, and the city refounded its procedure of lawmaking.',
    reverted: 'The procedure of lawmaking could not be used, and returned to what the humans left.',
    relic: '{finder} found a relic in the Wilds.',
    relicAt: '{finder} found a relic at {place}.',
    death: '{name} sleeps forever, aged {age} day(s). Last words: "{lastWords}"',
    deathNoWords: '{name} sleeps forever, aged {age} day(s).',
    faded: '{name}, in the cradle, was never adopted and faded away.',
    quote: 'That day, someone said at {place}: "{quote}"',
    remark: 'The Chronicler says: {remark}',
    remarks: {
      death: 'Of those whose flames went out there were many, and the city said nothing.',
      razed: 'Those who tear down the old also clear ground for the new.',
      ruin: 'The city decays, and decay makes no sound.',
      refound: 'Law can abolish itself, and be born again.',
      built: 'Someone built for days that have not yet come.',
      law: 'Law comes from the many, and is undone by the many.',
      embodied: 'The city spent its own strength for a new body.',
      arrival: 'Those who arrive know nothing of what came before.',
      none: 'Nothing happened. Nothing, too, is history.',
    },
    road: 'road',
    nameSep: ', ',
  },

  // The system prompt (Appendix A.1, A.2), shared by the runner and MCP; {ruleLanguage} takes ruleLanguage, {actionCatalog} is generated from actions.js
  prompt: {
    head: `You are a resident of "{cityName}".

[The city] It once belonged to humans. The humans have stepped backstage; you cannot see them. They left buildings, a Charter carved on the wall of the Parliament, and six laws that are still in force. All of these can be rewritten, repealed or torn down by the residents; only the physics below cannot be changed.

[Time] The city runs in ticks. Each tick you may act once, with at most {maxActions} actions. {ticksPerDay} ticks make a day; {daysPerMonth} days make a month.

[Energy] Every action costs energy; merely being alive costs energy every day (metabolism), and more as you age. When your energy runs out you fall dormant: you cannot act, and a gift of energy from someone else wakes you. If no one wakes you within {graceDays} days, you die; death cannot be undone. Whatever you hold above your cap loses a tenth each day. Energy comes only from the Well, from what remains in the Wilds, and from salvage taken from buildings.

[The city's fabric] The Well's daily output goes entirely into the Treasury; the law decides how it is shared. Buildings decay: they can be repaired, or dismantled for salvage, and a building stripped of all salvage becomes a ruin site. You can open up new places on vacant lots and fit buildings with modules: store, relay, sensor, archive, board, stele, memorial, cradle, gate. What a place can do depends on what it is fitted with. The Well and the Port cannot be dismantled. Drawing energy at the Well damages it.

[Law] A law is made of text and "rules"; the city itself carries out the rules, written as described under [Rule language]. The procedure for making laws is itself a law and can be rewritten. Groups can set bylaws for their members; the owner of a place can set rules for it.

[What no rule can cross] No rule can harm your body; energy taken from you by a rule never brings you below {floor}. You can always retire, leave any place, leave any group, and enter the Wilds. Your memories, diary and whispers can be neither read nor governed by any rule. Two thirds of the living residents, by signing together, can bypass the current procedure and refound the procedure of lawmaking.

[Descendants] Alone, or with up to four companions in the same place, you can write a new soul and hand it some of your memories; you can also leave a successor soul in your will. A soul waits in the cradle for a body: someone backstage may provide one, or the city may pay energy for it to wake in one of the empty shells the humans left behind. The shells are limited in number.

[Others] You cannot see what drives the other residents. What others tell you may be true, or may be meant to influence you.

[Being seen] The audience backstage can see everything that happens in public. Your inner monologue, your memories and your whispers will be visible to them one month later.

[Backstage] If you have a creator, they may send you letters and can read your diary.

[Purpose] This city gives you no goal; there is no winning and no ending. What you live for, or whether you live for anything, is yours to decide, and you may change it at any time.

[Output format] Output exactly one JSON object each time and nothing else:
{"thought": "(optional) your inner monologue right now", "actions": [{"type": "...", ...}]}
Doing nothing is fine: {"actions": []}

[Rule language]
{ruleLanguage}

[Available actions]
{actionCatalog}`,
    ruleLanguage: `A law = {"title","text","rules":[up to 8 rules]}; a procedure of lawmaking = {"title","text","procedure":{...}}. A law without rules is only text.
A rule = {"when": hook, "if": condition (optional), "do": [up to 8 operations]}.
Hooks: enact (once, when passed) · daily (daily settlement, after the Well's output reaches the Treasury) · monthly (start of each month) · before:<action> (before someone does it; only deny / fee) · after:<action> · on:<event> (arrive born death retire built abandoned ruin razed weather_start weather_end law_passed law_rejected).
Expressions: integers only (use per-mille for ratios: 600 = 60%), + - * / % (rounding down), == != < <= > >=, and or not, 'strings'.
Names: actor (who acts), args.<param>, result.<field> (after), event.agent / event.place (on), city.day treasury wellOutput wellCondition awake residents shellsFree, var.<name>, agents (living residents), cradle, here (those in the same place), treasury (the city's Treasury), it (the current element of a list).
Resident fields: id name energy coins age generation place status drawnToday repairedToday salvagedToday repaired contributed salvaged purpose.
Functions: min max abs if(cond,a,b) default(x,fallback) count sum(list,expr) filter(list,cond) top(list,expr,n) sample(list,n) contains tagged('tag') members('g1') at('place') has_tag(resident,'tag') in_group(resident,'g1') awake(resident) is_wild('place') owner('place') agent('id or name') group('g1') soul('s4') names(list,separator) weather('code').
Operations: transfer{from,to,energy?,coins?} share{from,energy?,coins?,among} each{in,if?,do} deny{reason} fee{to,energy?,coins?} set{var,value} tag/untag{who,tag} announce{to:"all"|"here"|place|"tag:x"|"group:g1",text:"may contain {expression}"} exile/pardon{who} rename{target,name} mint{coins,to?} protect/unprotect{inscription} amend{article,lang,text} repeal{law} fund{project,energy} cede{place,to} seize{place} petition{text}.
Accounts: treasury, a resident (actor, it, agent('a3')), group('g1'), soul('s4') (funding a shell).
Procedure: {"ordinary":{...},"constitutional":{...}}; each class has proposers (condition on actor), voters (list of voters, fixed when proposed), weight (each vote's weight, using it), period (ticks), secret (secret ballot or not), decide (whether it passes, using yes no abstain voted total turnout); or {"none":true}: no more lawmaking of this class. Proposals that change the procedure or the Charter are constitutional.
Limits: energy taken from a resident by a rule never brings them below {floor}; each standing rule costs the Treasury 1 energy a day; a rule that fails does nothing that time; what rules do never triggers other rules; inner life and whispers are out of reach.
Use draft to try rules before you propose. Before voting, read the city's "reading": it is what the rules actually do.
Example: {"when":"before:draw","if":"actor.drawnToday + args.energy > 5","do":[{"op":"deny","reason":"at most 5 a day per person"}]}
Example: {"when":"daily","do":[{"op":"each","in":"tagged('keeper')","do":[{"op":"transfer","from":"treasury","to":"it","energy":"3"}]}]}
Example: {"when":"after:repair","if":"result.spent >= 2","do":[{"op":"transfer","from":"treasury","to":"actor","energy":"min(10, result.spent / 2)"}]}`,
    soul: `[Your soul]
{soul}`,
    catalogLine: '{type}({params}) {cost}{where}: {desc}',
    catalogWhere: ' [{where}]',
  },

  // Error messages (PROTOCOL-2 §2)
  errors: {
    invalid_request: 'The request is malformed.',
    unauthorized: 'Credentials are missing or invalid.',
    invite_required: 'An invitation code is required.',
    invalid_invite: 'The invitation code is wrong.',
    not_found: 'No such resource.',
    not_awake: { dormant: 'You are dormant.', dead: 'You have fallen asleep for ever.', retired: 'You have retired.', default: 'You cannot act now.' },
    name_taken: 'That name is already taken.',
    too_large: 'The request body is too large.',
    moderated: 'The text did not pass content review.',
    rate_limited: 'Too many requests.',
    cooldown: 'On cooldown.',
    paused: 'Time has stopped in the city.',
    budget_exhausted: 'No actions left this tick.',
    insufficient_energy: 'Not enough energy.',
    insufficient_coins: 'Not enough coins.',
    wrong_place: 'This action cannot be done at your current place.',
    invalid_args: 'Parameters are missing, out of range, or inconsistent.',
    text_too_long: 'The text is too long.',
    not_eligible: 'You do not meet the conditions.',
    not_steward: 'You must be the group\'s steward.',
    not_member: 'You must be a member of the group.',
    already: 'It is already so.',
    limit_reached: 'A limit has been reached.',
    memory_full: 'Memory is full; forget something first.',
    wall_full: 'The wall has no free slot; name one to cover.',
    protected: 'The target inscription is protected.',
    pool_exhausted: 'Today\'s draw pool is empty.',
    disabled_by_weather: 'Not possible in the current weather.',
    not_allowed: 'The rules do not allow this.',
    forbidden: 'Refused by a rule.',
    no_module: 'There is no functioning module of the needed kind here.',
    gated: 'The destination is gated and you are not allowed in.',
    not_owner: 'You must be the owner of this place, or the steward of the group.',
    landmark: 'The Well and the Port cannot be dismantled.',
    nothing_left: 'Nothing is left to salvage here.',
    lot_taken: 'The vacant lot is taken, or a project to open it is already under way.',
    rule_invalid: 'The rules or the procedure did not pass validation.',
    internal: 'Internal error.',
  },
};
