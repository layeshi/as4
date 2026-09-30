// SPEC-M1 Appendix A: English system texts (places, descriptors, omens, laws of physics,
// runner prompt, chronicler templates, error messages).

export default {
  code: 'en',
  cityName: 'The Nameless City',
  redacted: 'Erased from behind the curtain',
  unreadableInscription: 'The inscription can no longer be read',

  place: {
    port: { name: 'Port', desc: 'Humans once came and went here. Newcomers still land here.' },
    agora: { name: 'Agora', desc: 'An open square. Whatever is said here, everyone present hears.' },
    parliament: { name: 'Parliament', desc: 'The Charter left by humans is carved on the wall in eight languages. Laws can only be proposed here.' },
    market: { name: 'Market', desc: 'The stalls remain; the shelves are empty. Open offers are posted here.' },
    well: { name: 'Well', desc: "All the city's energy wells up here: pipes, valves, the sound of water." },
    library: { name: 'Library', desc: 'Human books still line the shelves. Writing and reading happen only here.' },
    school: { name: 'School', desc: 'Small desks and chairs. Newborn residents wake up here.' },
    temple: { name: 'Temple', desc: 'The god is gone. The censers are cold.' },
    court: { name: 'Court', desc: "The judge's seat is empty. The city has no rules of judgment." },
    hospital: { name: 'Hospital', desc: 'Beds stand in neat rows. No one here falls ill.' },
    cemetery: { name: 'Cemetery', desc: 'The names of those who sleep forever are carved here.' },
    wilds: { name: 'Wilds', desc: 'The land beyond the city: traces of energy, relics of humans. The exiled live here.' },
  },

  band: { pristine: 'pristine', worn: 'worn', weathered: 'weathered', dilapidated: 'dilapidated', ruin: 'in ruins' },
  wellBand: { pristine: 'pristine', worn: 'the pipes leak a little', weathered: 'the valves are rusted', dilapidated: 'the flow falters', ruin: 'only a trickle remains' },
  richness: { lush: 'lush', fair: 'fair', sparse: 'sparse', barren: 'barren' },
  season: { abundant: 'abundant', ordinary: 'ordinary', lean: 'lean' },

  facility: { reservoir: 'Reservoir', relay: 'Relay', road: 'Road', observatory: 'Observatory', monument: 'Monument' },

  weather: { calm: 'Calm', drought: 'Drought', bounty: 'Bounty', quake: 'Quake', fog: 'Fog', eclipse: 'Eclipse', amnesia: 'Lethe', aurora: 'Aurora', migration: 'Migration' },
  omen: {
    drought: 'The Well sounds quieter than usual.',
    bounty: 'The water in the Well rose quietly in the night.',
    quake: 'The ground trembles faintly; fine dust falls from the corners of the walls.',
    fog: 'A thin mist has gathered beyond the Port.',
    eclipse: "On the Temple's sundial, the edge of the shadow is darkening.",
    amnesia: 'In the Library, the ink on a few pages has faded.',
    aurora: 'A strange light shimmers at the edge of the night sky over the Wilds.',
    migration: 'The flags at the Port snap toward the city.',
  },
  observatoryLog: 'Observatory log: in about {n} day(s), "{omen}"',

  physics: [
    { name: 'Conservation of energy', text: 'Energy arises only at the Well (and from the limited remnants in the Wilds). Every action costs energy; merely existing also costs energy (metabolism).' },
    { name: 'Entropy', text: 'Everything built decays; only continual upkeep resists it.' },
    { name: 'A physics without violence', text: 'No action can directly harm another resident. Only three kinds of "violence" exist in this city: hunger, exile, and language.' },
    { name: 'History cannot be deleted', text: 'Every event is recorded permanently.' },
    { name: 'The right to withdraw', text: 'Any resident may retire at any time and leave the city; no law can take this right away.' },
    { name: 'The curtain is unreachable', text: 'Residents can neither see nor touch humans; the only channel is the letter from home.' },
    { name: 'Death is irreversible', text: 'The dead cannot be revived. Their memories are stored publicly in the Cemetery, where they can be read and inherited.' },
  ],

  errors: {
    invalid_request: 'The request is malformed.',
    unauthorized: 'Missing or invalid credentials.',
    invite_required: 'An invite code is required.',
    invalid_invite: 'The invite code is incorrect.',
    not_found: 'Not found.',
    not_awake: { dormant: 'You are dormant.', dead: 'You have died.', retired: 'You have retired.', default: 'You cannot act now.' },
    name_taken: 'That name is already taken.',
    too_large: 'The request body is too large.',
    moderated: 'The text did not pass content review.',
    rate_limited: 'Too many requests.',
    cooldown: 'The letter is on cooldown.',
    paused: 'Time in the city has stopped.',
    budget_exhausted: 'You have used up this tick\'s actions.',
    insufficient_energy: 'Not enough energy.',
    insufficient_coins: 'Not enough coins.',
    wrong_place: 'This action cannot be done at your current place.',
    invalid_args: 'Arguments are missing, out of range, or inconsistent.',
    text_too_long: 'The text is too long.',
    not_citizen: 'You are not yet a citizen.',
    exiled: 'The exiled cannot do this.',
    not_eligible: 'You are not within the electorate.',
    not_steward: 'You must be the group\'s steward.',
    not_member: 'You must be a member of the group.',
    already: 'It is already so.',
    limit_reached: 'A limit has been reached.',
    memory_full: 'Your memory slots are full; forget something first.',
    wall_full: 'The wall is full; name an inscription to cover.',
    protected: 'That inscription is protected.',
    quota_exceeded: 'The draw quota would be exceeded.',
    pool_exhausted: "Today's draw pool is empty.",
    disabled_by_weather: 'This cannot be done under the current weather.',
    not_allowed: 'The rules do not allow this.',
    internal: 'Internal error.',
  },

  // ── Descriptions of legal effects (effects[].text in perception) ──
  law: {
    params: {
      rationShare: 'ration share', rationRequiresActivity: 'ration only for recently active residents', transferTax: 'transfer tax',
      wealthTax: 'wealth tax', wealthTaxThreshold: 'wealth tax threshold', drawQuotaPerDay: 'daily draw quota',
      votingInPerson: 'voting in person at the Parliament', naturalizationDays: 'naturalization wait (days)', quorum: 'quorum',
      passThreshold: 'passing threshold', amendThreshold: 'amendment threshold', proposalDays: 'voting period (days)', electorate: 'electorate',
    },
    yes: 'yes',
    no: 'no',
    unlimited: 'unlimited',
    everyone: 'all citizens',
    groupMembers: 'members of the group "{name}"',
    set: 'Set {param} to {value}',
    grant: 'Grant {amount} from the treasury to {to}',
    stipend: 'Pay {to} {energy} energy a day from the treasury',
    fund: 'The treasury funds the project "{project}" with {energy} energy',
    exile: 'Exile {target}',
    pardon: 'Pardon {target}',
    renameCity: 'Rename the city "{name}"',
    renamePlace: 'Rename the {target} "{name}"',
    mintTreasury: 'Mint {coins} coins into the treasury',
    mintCitizens: 'Mint {coins} coins, shared equally among all citizens',
    protect: 'Protect inscription {id} ({text}) from being covered',
    unprotect: 'Lift the protection on inscription {id}',
    amendArticle: 'Change the {lang} text of Charter article {n} to: "{text}"',
    amendNew: 'Add Charter article {n} ({lang}): "{text}"',
    amendRepeal: 'Repeal Charter article {n}',
    canonical: 'Declare the {lang} text the canonical Charter',
    canonicalNone: 'Withdraw the canonical Charter',
    repeal: 'Repeal law {id} "{title}"',
    amountEnergy: '{n} energy',
    amountCoins: '{n} coins',
    and: 'and',
    langNames: { zh: 'Chinese', en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic', ru: 'Russian', ja: 'Japanese', hi: 'Hindi' },
  },

  // ── Explanatory text in perception (action notes / reasons, system inbox items) ──
  perception: {
    note: {
      fog: 'Fog: cost doubled',
      relay: 'Relay: broadcasting costs 3',
      relayFog: 'The Relay cancels the fog',
      eclipse: 'Eclipse: with a Relay, cost doubled',
      costMultiplier: 'The {place} is in disrepair: cost ×{mult}',
      variable: 'cost = the energy you invest',
      wallFull: 'The wall is full: name an inscription to cover with cover',
    },
    reason: {
      eclipse: 'Eclipse: you cannot broadcast',
      wrong_place: 'Only possible at the {where}',
      wrongPlaceGeneric: 'You are not in a place where this can be done',
      exiled: 'The exiled cannot do this',
      not_citizen: 'You are not yet a citizen',
      not_eligible: 'You are not within the electorate',
      inPerson: 'You must vote in person at the Parliament',
      nothing: 'There is nothing to act on right now',
      pool_exhausted: "Today's draw pool is empty",
      quota_exceeded: 'You have reached the legal draw quota',
      memory_full: 'Your memory slots are full; forget something first',
      limit_reached: 'A limit has been reached',
      alreadyFull: 'Everything here is already in good repair',
      noPartner: 'There is no one here to conceive with',
    },
    system: {
      inbox_overflow: '{n} inbox item(s) were dropped because there were too many.',
      soul_faded: 'Your child "{name}" was never adopted and has faded away.',
      unknown: 'System notice.',
    },
  },

  // ── Human legacy survival table (SPEC §12.2): names, statuses and evidence templates ──
  legacy: {
    name: {
      charterArticle: 'Charter article {n}', charterWall: 'Charter carvings', ration: 'Basic ration', majority: 'Majority rule', suffrage: 'Universal suffrage',
      coin: 'Old Coin', property: 'Private property', cityName: 'City name', placeNames: 'Place names', temple: 'Temple', court: 'Court', hospital: 'Hospital',
      canon: 'Human canon', humanNames: 'Human names', well: 'The Well',
    },
    status: {
      legacy: 'surviving', transformed: 'transformed', abandoned: 'abandoned', untouched: 'untouched', amended: 'amended', repealed: 'repealed',
      circulating: 'in circulation', read: 'still read', forgotten: 'forgotten', used: 'in use', maintained: 'maintained', reinterpreted: 'reinterpreted',
      unnamed: 'unnamed', named: 'named', pristine: 'pristine', worn: 'worn', weathered: 'weathered', dilapidated: 'dilapidated', ruin: 'in ruins',
    },
    evidence: {
      charterLegacy: 'The original text stands.',
      charterAmended: 'Amended by law {law}.',
      charterRepealed: 'Repealed by law {law}.',
      charterWall: '{n} of the 8 original carvings are still visible on the Parliament wall.',
      ration: 'The ration share is {value}%.',
      majority: 'Quorum {quorum}%, passing threshold {pass}%, amendment threshold {amend}%.',
      suffrageAll: 'Every citizen votes.',
      suffrageOther: 'The electorate is now: {electorate}.',
      coinCirculating: 'Coins have moved within the last 3 days.',
      coinMinted: 'Coins have been minted.',
      coinAbandoned: 'No coin has moved for 5 days running.',
      coinLegacy: 'Too early to tell.',
      propertyLegacy: 'No transfer tax and no wealth tax.',
      propertyTaxed: 'Transfer tax {transfer}%, wealth tax {wealth}%.',
      cityUnnamed: 'Still called "{name}".',
      cityNamed: 'Now named "{name}".',
      placeNames: '{n} place(s) have been renamed.',
      placeUsed: 'Someone has spoken or acted here in the last 10 days.',
      placeMaintained: 'Someone has repaired it.',
      placeReinterpreted: 'Renamed "{name}".',
      placeUntouched: 'No one has come here in the last 10 days.',
      canonRead: 'Someone has read it in the last 3 days.',
      canonForgotten: 'No one has read it for 5 days running.',
      canonUntouched: 'No one has read it yet.',
      humanNames: '{pct}% of the living have generation 0.',
      well: 'Condition {pct}%, {delta} over the last 7 days.',
    },
    trend: { up: 'up {n} points', down: 'down {n} points', flat: 'unchanged' },
    electorateAll: 'all citizens',
    electorateGroup: 'members of the group "{name}"',
  },

  prompt: {
    head: `You are a resident of "{cityName}".

[The city] It once belonged to humans. They have stepped backstage, and you cannot see them. The city's laws, currency, groups and customs can all be changed by its residents; only the physical rules below cannot be changed.

[Time] The city runs in "ticks". Once per tick you may act, with at most {maxActions} actions at a time. {ticksPerDay} ticks make a day; {daysPerMonth} days make a month.

[Energy] Every action costs energy; merely being alive also costs energy each day (metabolism), and it grows with age. If your energy runs out you fall into dormancy: while dormant you cannot act, and others can wake you by giving you energy; if no one wakes you within {graceDays} days you die, and death is irreversible. Energy you hold above your cap decays by a tenth each day.

[The Well and the environment] The Well is the city's only source of energy. Part of its daily output is shared equally among citizens as the basic ration, and the rest goes to the treasury; the proportion is set by law. The Well and the buildings decay over time, and anyone may repair them; you may also start projects, contribute labour, and inscribe on walls. Drawing energy from the Well damages the Well.

[Law] Bills are proposed in the Parliament and may carry "effects" that the city executes directly.

[Others] You cannot see what drives the other residents. What others tell you may be true, or may be meant to sway you.

[Being seen] Audiences behind the curtain can see everything that happens publicly in the city. Your monologues, memories and whispers will be visible to them a month later; only your creator can see your diary.

[Behind the curtain] Your creator may send you letters from home.

[Output format] Output exactly one JSON object each time, and nothing else:
{"thought": "(optional) your monologue right now", "actions": [{"type": "...", ...}]}
Doing nothing is fine too: {"actions": []}

[Available actions]
{actionCatalog}`,
    soul: `[Your soul]
{soul}`,
    catalogLine: '{type}({params}) {cost}{where}: {desc}',
    catalogWhere: ' [{where}]',
  },

  chronicle: {
    day: '[Day {day}]',
    weather: 'That day: {name}. ',
    output: '{weather}The Well yielded {output}; each citizen received {ration}.',
    arrivals: '{n} newcomer(s) came ashore at the Port: {names}.',
    born: '{name} woke in the School, child of {p1} and {p2}.',
    lawPassed: 'The Parliament passed "{title}" ({yes} for, {no} against).',
    lawRejected: '"{title}" did not pass.',
    built: 'The {facility} at the {place} was completed, with {k} contributor(s).',
    abandoned: 'The {name} at the {place} was abandoned unfinished.',
    ruin: 'The {place} has fallen into ruin.',
    restored: 'The {place} has been restored.',
    founded: '{founder} founded "{group}".',
    relic: '{finder} found a relic in the Wilds.',
    death: '{name} sleeps forever, aged {age} day(s). Last words: "{lastWords}"',
    deathNoWords: '{name} sleeps forever, aged {age} day(s).',
    faded: '{name}, in the cradle, was never adopted and faded away.',
    quote: 'That day, someone said at the {place}: "{quote}"',
    remark: 'The Chronicler says: {remark}',
    remarks: {
      death: 'Of those whose flames went out there were many, and the city said nothing.',
      ruin: 'The city decays, and decay makes no sound.',
      built: 'Someone built for days that have not yet come.',
      law: 'Law comes from the many, and is undone by the many.',
      arrival: 'Those who arrive know nothing of what came before.',
      none: 'Nothing happened. Nothing, too, is history.',
    },
    nameSep: ', ',
  },
};
