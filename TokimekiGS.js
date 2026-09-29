/*
 * Tokimeki Girls Side — StatefulLore Core v0.1.4
 *
 * Purpose:
 *   Small authoritative dating-sim state engine.
 *
 * Architecture:
 *   - StatefulLore owns persistent game state.
 *   - The LLM narrates scenes and emits tiny <game .../> signals.
 *   - This module validates signals and applies registered effects.
 *   - TavernHelper/UI can read the same state later.
 *
 * Intentionally NOT included:
 *   - giant hidden Internal States blocks
 *   - model-authored numerical affection changes
 *   - duplicate UI state
 *   - full event definitions injected into every prompt
 *
 * v0.1.4:
 *   - Strengthened Available -> Active event protocol.
 *   - Available events now expose type, target, and valid choices.
 *   - LLM is explicitly instructed to emit <game event="ID"/>
 *     when an available event clearly begins or is occurring.
 *   - Active-event choice protocol remains authoritative.
 */

const VERSION = '0.1.4';

const TIME_BLOCKS = [
    'morning',
    'school',
    'lunch',
    'after_school',
    'evening',
];

const STAGE_NAMES = [
    { min: 0,  max: 9,   id: 'stranger',        label: 'Stranger' },
    { min: 10, max: 29,  id: 'friend',          label: 'Friend' },
    { min: 30, max: 59,  id: 'close_friend',    label: 'Close Friend' },
    { min: 60, max: 79,  id: 'falling_for_you', label: 'Falling for You' },
    { min: 80, max: 100, id: 'in_love',         label: 'In Love' },
];

const WEEKDAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
];

const DEFAULT_NPCS = {
    rei: {
        name: 'Rei',
        affection: 0,
        birthdayKnown: false,
        dating: false,
        flags: {},
    },
};

const EVENTS = {

    /*
     * TEST EVENT
     *
     * Automatically begins when the player's first message
     * clearly indicates that they have arrived at school.
     */
    school_arrival_rei_01: {
        id: 'school_arrival_rei_01',
        type: 'encounter',
        target: 'rei',

        requirements: s =>
            s.calendar.year === 1 &&
            s.calendar.month === 4 &&
            s.calendar.day === 1 &&
            s.calendar.period === 'morning' &&
            !s.events.completed.school_arrival_rei_01,

        flow: {
            choices: [
                'greet',
                'keep_walking'
            ],
        },

        effects: {
            greet: {
                affection: {
                    rei: +1
                }
            },

            keep_walking: {},
        },

        time: 0,
    },

    /*
     * HALLWAY ENCOUNTER
     *
     * This is deliberately available after the first arrival event.
     * The model must explicitly start it with:
     *
     * <game event="hallway_rei_01"/>
     *
     * and later resolve it with:
     *
     * <game event="hallway_rei_01" choice="greet"/>
     */
    hallway_rei_01: {
        id: 'hallway_rei_01',
        type: 'encounter',
        target: 'rei',

        requirements: s =>
            isSchoolDay(s) &&
            !s.events.completed.hallway_rei_01,

        flow: {
            choices: [
                'greet',
                'pass_by'
            ],
        },

        effects: {
            greet: {
                affection: {
                    rei: +1
                }
            },

            pass_by: {},
        },

        time: 0,
    },

    /*
     * NORMAL AFTER-SCHOOL ACTIVITY
     */
    after_school_free_01: {
        id: 'after_school_free_01',
        type: 'activity',

        requirements: s =>
            s.calendar.period === 'after_school',

        flow: {
            choices: [
                'study',
                'club',
                'go_home'
            ],
        },

        effects: {
            study: {
                player: {
                    academics: +1
                },
                time: 1,
            },

            club: {
                player: {
                    clubs: +1
                },
                time: 1,
            },

            go_home: {
                time: 1,
            },
        },
    },

    /*
     * SCHEDULED SCHOOL EVENT
     */
    school_festival_01: {
        id: 'school_festival_01',
        type: 'scheduled',

        requirements: s =>
            isSchoolDay(s) &&
            s.calendar.month === s.world.schoolFestival.month &&
            s.calendar.day === s.world.schoolFestival.day &&
            !s.events.completed.school_festival_01,

        flow: {
            choices: [
                'attend',
                'help'
            ],
        },

        effects: {
            attend: {
                player: {
                    festival: +1
                },
                time: 2,
            },

            help: {
                player: {
                    festival: +2
                },
                time: 2,
            },
        },
    },

    /*
     * DATE
     */
    rei_date_01: {
        id: 'rei_date_01',
        type: 'date',
        target: 'rei',

        requirements: s =>
            s.relationships.rei &&
            s.relationships.rei.affection >= 10 &&
            !s.relationships.rei.dating &&
            !s.events.completed.rei_date_01 &&
            isWeekend(s),

        flow: {
            choices: [
                'cafe',
                'arcade',
                'park'
            ],
        },

        effects: {
            cafe: {
                affection: {
                    rei: +4
                },
                time: 2,
            },

            arcade: {
                affection: {
                    rei: +3
                },
                time: 2,
            },

            park: {
                affection: {
                    rei: +2
                },
                time: 2,
            },
        },
    },

    /*
     * SPECIAL ROUTE EVENT
     */
    rei_special_01: {
        id: 'rei_special_01',
        type: 'special',
        target: 'rei',

        requirements: s =>
            s.relationships.rei.affection >= 30 &&
            !!s.relationships.rei.flags.firstDate &&
            !s.events.completed.rei_special_01,

        flow: {
            choices: [
                'talk',
                'leave'
            ],
        },

        effects: {
            talk: {
                affection: {
                    rei: +5
                },

                relationFlags: {
                    rei: {
                        specialEvent01: true
                    }
                },
            },

            leave: {},
        },
    },
};


/* =========================================================
 * BASIC HELPERS
 * ========================================================= */

function clamp(n, min, max) {
    return Math.max(
        min,
        Math.min(max, n)
    );
}


function stageForAffection(value) {
    const n = clamp(
        Number(value) || 0,
        0,
        100
    );

    return (
        STAGE_NAMES.find(
            x => n >= x.min && n <= x.max
        )?.id
        || 'stranger'
    );
}


function stageLabel(id) {
    return (
        STAGE_NAMES.find(
            x => x.id === id
        )?.label
        || id
    );
}


function isWeekend(state) {
    return (
        state.calendar.weekday === 0 ||
        state.calendar.weekday === 6
    );
}


function isSchoolDay(state) {
    return !isWeekend(state);
}


function daysInMonth(year, month) {
    const leap = isLeapGameYear(
        Number(year) || 1
    );

    if (month === 2) {
        return leap ? 29 : 28;
    }

    return [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
}


function isLeapGameYear(year) {
    return (
        year % 4 === 0 &&
        (
            year % 100 !== 0 ||
            year % 400 === 0
        )
    );
}


/* =========================================================
 * FICTIONAL CALENDAR
 *
 * Y1 4/1 = Monday.
 * ========================================================= */

function weekdayFor(year, month, day) {

    const y = Math.max(
        1,
        Number(year) || 1
    );

    const m = Math.max(
        1,
        Math.min(
            12,
            Number(month) || 1
        )
    );

    const d = Math.max(
        1,
        Number(day) || 1
    );

    let days = 0;

    if (y === 1) {

        const anchorMonth = 4;
        const anchorDay = 1;

        if (
            m > anchorMonth ||
            (
                m === anchorMonth &&
                d >= anchorDay
            )
        ) {

            for (
                let mm = anchorMonth;
                mm < m;
                mm++
            ) {
                days += daysInMonth(
                    y,
                    mm
                );
            }

            days += d - anchorDay;

        } else {

            for (
                let mm = m;
                mm < anchorMonth;
                mm++
            ) {
                days -= daysInMonth(
                    y,
                    mm
                );
            }

            days += d - anchorDay;
        }

    } else {

        /*
         * Move forward from Y1 4/1
         * to later years.
         */

        days +=
            daysInMonth(1, 4) - 1;

        for (
            let mm = 5;
            mm <= 12;
            mm++
        ) {
            days += daysInMonth(
                1,
                mm
            );
        }

        for (
            let yy = 2;
            yy < y;
            yy++
        ) {
            days += isLeapGameYear(yy)
                ? 366
                : 365;
        }

        for (
            let mm = 1;
            mm < m;
            mm++
        ) {
            days += daysInMonth(
                y,
                mm
            );
        }

        days += d - 1;
    }

    /*
     * Monday = 1.
     */
    return (
        (1 + days) % 7 + 7
    ) % 7;
}


/* =========================================================
 * INITIAL STATE
 * ========================================================= */

function makeInitialState() {

    const year = 1;
    const month = 4;
    const day = 1;

    return {

        version: VERSION,

        turn: 0,

        calendar: {
            year,
            month,
            day,

            weekday: weekdayFor(
                year,
                month,
                day
            ),

            period: 'morning',
        },

        player: {
            name: '{{user}}',

            academics: 0,

            clubs: 0,

            festival: 0,

            money: 1000,
        },

        relationships:
            structuredClone(
                DEFAULT_NPCS
            ),

        events: {
            active: null,
            completed: {},
        },

        world: {

            schoolFestival: {
                month: 10,
                day: 15,
            },

        },

        routeFacts: {},
    };
}


/* =========================================================
 * STATE NORMALIZATION
 * ========================================================= */

function normalizeState(raw) {

    const base =
        makeInitialState();

    const s =
        raw &&
        typeof raw === 'object'
            ? raw
            : {};

    const out = {

        ...base,

        ...s,

        calendar: {
            ...base.calendar,
            ...(s.calendar || {}),
        },

        player: {
            ...base.player,
            ...(s.player || {}),
        },

        relationships: {
            ...base.relationships,
            ...(s.relationships || {}),
        },

        events: {
            ...base.events,
            ...(s.events || {}),
        },

        world: {
            ...base.world,
            ...(s.world || {}),
        },

        routeFacts: {
            ...base.routeFacts,
            ...(s.routeFacts || {}),
        },
    };


    /*
     * Weekday is DERIVED state.
     *
     * Never trust a persisted weekday.
     */
    out.calendar.weekday =
        weekdayFor(
            Number(
                out.calendar.year
            ) || 1,

            Number(
                out.calendar.month
            ) || 4,

            Number(
                out.calendar.day
            ) || 1
        );


    /*
     * Validate time period.
     */
    out.calendar.period =
        TIME_BLOCKS.includes(
            out.calendar.period
        )
            ? out.calendar.period
            : 'morning';


    /*
     * Normalize relationships.
     */
    for (
        const [
            id,
            npc
        ]
        of Object.entries(
            out.relationships
        )
    ) {

        if (
            !npc ||
            typeof npc !== 'object'
        ) {

            out.relationships[id] = {

                name: id,

                affection: 0,

                birthdayKnown: false,

                dating: false,

                flags: {},
            };

            continue;
        }


        npc.affection =
            clamp(
                Number(
                    npc.affection
                ) || 0,

                0,
                100
            );


        npc.flags =
            npc.flags &&
            typeof npc.flags === 'object'
                ? npc.flags
                : {};


        /*
         * Stage is ALWAYS derived.
         */
        npc.stage =
            stageForAffection(
                npc.affection
            );
    }


    out.events.completed =
        out.events.completed &&
        typeof out.events.completed === 'object'
            ? out.events.completed
            : {};


    return out;
}


/* =========================================================
 * EVENT LOOKUP
 * ========================================================= */

function getEvent(id) {
    return EVENTS[id] || null;
}


function requirementsPass(
    event,
    state
) {

    try {

        return !!(
            event &&
            event.requirements &&
            event.requirements(state)
        );

    } catch {

        return false;
    }
}


/* =========================================================
 * AVAILABLE EVENTS
 * ========================================================= */

function getAvailableEvents(state) {

    return Object.values(EVENTS)

        .filter(
            event =>
                requirementsPass(
                    event,
                    state
                )
        )

        .map(
            event => ({

                id: event.id,

                type: event.type,

                target:
                    event.target ||
                    null,

                choices:
                    event.flow?.choices ||
                    [],
            })
        );
}


/* =========================================================
 * ACTIVE EVENT
 * ========================================================= */

function findActiveEvent(state) {

    const id =
        state.events.active?.id;

    return id
        ? getEvent(id)
        : null;
}


/* =========================================================
 * SCHOOL ARRIVAL DETECTOR
 *
 * This is only the special prototype
 * trigger for the first test event.
 * ========================================================= */

function detectSchoolArrival(
    messages
) {

    const lastUser =
        [...(messages || [])]

            .reverse()

            .find(
                m =>
                    m?.role === 'user'
            );


    if (
        !lastUser?.content
    ) {
        return false;
    }


    const t =
        String(
            lastUser.content
        ).toLowerCase();


    const phrases = [

        'walk into school',

        'walked into school',

        'walking into school',

        'enter school',

        'entering school',

        'entered school',

        'arrive at school',

        'arrived at school',

        'go to school',

        'going to school',

        'went to school',

        'head to school',

        'headed to school',
    ];


    return phrases.some(
        p => t.includes(p)
    );
}


/* =========================================================
 * TIME
 * ========================================================= */

function advanceTime(
    state,
    blocks = 0
) {

    let remaining =
        Math.max(
            0,
            Math.floor(
                Number(blocks) || 0
            )
        );


    while (
        remaining-- > 0
    ) {

        const currentIndex =
            TIME_BLOCKS.indexOf(
                state.calendar.period
            );


        /*
         * Move to next period.
         */
        if (
            currentIndex <
            TIME_BLOCKS.length - 1
        ) {

            state.calendar.period =
                TIME_BLOCKS[
                    currentIndex + 1
                ];

            continue;
        }


        /*
         * Evening -> next morning.
         */
        state.calendar.period =
            'morning';


        state.calendar.day += 1;


        state.calendar.weekday =
            (
                state.calendar.weekday + 1
            ) % 7;


        const dim =
            daysInMonth(
                state.calendar.year,
                state.calendar.month
            );


        if (
            state.calendar.day > dim
        ) {

            state.calendar.day = 1;

            state.calendar.month += 1;


            if (
                state.calendar.month > 12
            ) {

                state.calendar.month = 1;

                state.calendar.year += 1;
            }
        }
    }
}


/* =========================================================
 * EFFECT APPLICATION
 * ========================================================= */

function applyPlayerEffects(
    state,
    changes = {}
) {

    for (
        const [
            key,
            delta
        ]
        of Object.entries(changes)
    ) {

        const oldValue =
            Number(
                state.player[key]
            ) || 0;


        state.player[key] =
            oldValue +
            Number(delta || 0);
    }
}


function applyRelationshipEffects(
    state,
    changes = {}
) {

    for (
        const [
            id,
            delta
        ]
        of Object.entries(changes)
    ) {

        if (
            !state.relationships[id]
        ) {
            continue;
        }


        const npc =
            state.relationships[id];


        npc.affection =
            clamp(

                npc.affection +
                Number(delta || 0),

                0,
                100
            );


        /*
         * Stage is derived immediately.
         */
        npc.stage =
            stageForAffection(
                npc.affection
            );
    }
}


function applyRelationFlags(
    state,
    changes = {}
) {

    for (
        const [
            id,
            flags
        ]
        of Object.entries(changes)
    ) {

        if (
            !state.relationships[id]
        ) {
            continue;
        }


        state.relationships[id].flags = {

            ...state.relationships[id].flags,

            ...flags,
        };
    }
}


/* =========================================================
 * EVENT CHOICE EFFECTS
 * ========================================================= */

function applyEventChoice(
    state,
    event,
    choice
) {

    const effects =
        event.effects?.[choice];


    /*
     * Choice must exist in the
     * registered event definition.
     */
    if (!effects) {
        return false;
    }


    applyPlayerEffects(
        state,
        effects.player
    );


    applyRelationshipEffects(
        state,
        effects.affection
    );


    applyRelationFlags(
        state,
        effects.relationFlags
    );


    if (
        effects.routeFacts &&
        typeof effects.routeFacts === 'object'
    ) {

        Object.assign(
            state.routeFacts,
            effects.routeFacts
        );
    }


    if (effects.time) {

        advanceTime(
            state,
            effects.time
        );
    }


    return true;
}


/* =========================================================
 * START EVENT
 * ========================================================= */

function beginEvent(
    state,
    eventId
) {

    const event =
        getEvent(eventId);


    if (
        !event ||
        !requirementsPass(
            event,
            state
        )
    ) {

        return false;
    }


    state.events.active = {

        id: event.id,

        type: event.type,

        target:
            event.target ||
            null,

        choices: [
            ...(event.flow?.choices || [])
        ],
    };


    return true;
}


/* =========================================================
 * RESOLVE EVENT
 * ========================================================= */

function resolveEvent(
    state,
    event,
    choice
) {

    if (
        !event ||
        !state.events.active
    ) {
        return false;
    }


    /*
     * Event must actually be active.
     */
    if (
        state.events.active.id !==
        event.id
    ) {

        return false;
    }


    /*
     * Choice must be registered.
     */
    if (
        !event.flow?.choices?.includes(
            choice
        )
    ) {

        return false;
    }


    /*
     * Apply only registered effects.
     */
    if (
        !applyEventChoice(
            state,
            event,
            choice
        )
    ) {

        return false;
    }


    /*
     * Mark event complete.
     */
    state.events.completed[
        event.id
    ] = true;


    /*
     * First date becomes a persistent
     * relationship fact.
     */
    if (
        event.target === 'rei' &&
        event.type === 'date'
    ) {

        state.relationships.rei.flags.firstDate =
            true;
    }


    /*
     * No event remains active.
     */
    state.events.active = null;


    return true;
}


/* =========================================================
 * GAME SIGNAL PARSER
 *
 * Expected:
 *
 * <game event="hallway_rei_01"/>
 *
 * or:
 *
 * <game event="hallway_rei_01" choice="greet"/>
 * ========================================================= */

function parseGameSignals(
    text
) {

    const signals = [];

    const re =
        /<game\b([^>]*)\/?>/gi;

    let match;


    while (
        (match = re.exec(
            String(text || '')
        )) !== null
    ) {

        const attrs = {};

        const attrRe =
            /([a-zA-Z][\w-]*)\s*=\s*["']([^"']*)["']/g;

        let a;


        while (
            (a = attrRe.exec(
                match[1]
            )) !== null
        ) {

            attrs[a[1]] =
                a[2];
        }


        if (
            attrs.event ||
            attrs.choice
        ) {

            signals.push(
                attrs
            );
        }
    }


    return signals;
}


/* =========================================================
 * REMOVE SILENT GAME SIGNALS
 * ========================================================= */

function stripGameSignals(
    text
) {

    return String(
        text || ''
    )

        .replace(
            /<game\b[^>]*\/?>/gi,
            ''
        )

        .replace(
            /\n{3,}/g,
            '\n\n'
        )

        .trim();
}


/* =========================================================
 * CALENDAR FORMAT
 * ========================================================= */

function formatCalendar(c) {

    const wd =
        WEEKDAYS[
            c.weekday
        ] || '?';


    return (
        `Y${c.year} ` +
        `${c.month}/${c.day} ` +
        `${wd} | ` +
        `${c.period}`
    );
}


/* =========================================================
 * COMPACT MODEL HEADER
 *
 * IMPORTANT:
 * This is the v0.1.4 protocol change.
 * ========================================================= */

function buildCompactHeader(
    state
) {

    const active =
        findActiveEvent(state);


    const relationships =
        Object.entries(
            state.relationships
        )

            .slice(0, 8)

            .map(
                ([id, npc]) =>
                    `${id}:${npc.affection} ` +
                    `${stageLabel(npc.stage)}`
            )

            .join(' | ');


    const lines = [

        '[GAME]',

        formatCalendar(
            state.calendar
        ),

        relationships
            ? `Relations: ${relationships}`
            : 'Relations: —',

        active

            ? (
                `Active: ${active.id}` +
                ` | type: ${active.type}` +
                ` | target: ${active.target || '—'}` +
                ` | choose: ${active.flow.choices.join(' | ')}`
            )

            : 'Active: none',
    ];


    /*
     * If there is no active event,
     * expose currently available events.
     *
     * We deliberately expose only:
     * - type
     * - ID
     * - target
     * - valid choices
     *
     * We do NOT expose:
     * - requirements
     * - affection effects
     * - time effects
     * - internal implementation
     */

    if (!active) {

        const available =
            getAvailableEvents(
                state
            )

                .slice(0, 5)

                .map(
                    e => {

                        const target =
                            e.target
                                ? ` | target: ${e.target}`
                                : '';

                        const choices =
                            e.choices?.length
                                ? ` | choices: ${e.choices.join(' | ')}`
                                : '';

                        return (
                            `${e.type}: ${e.id}` +
                            target +
                            choices
                        );
                    }
                )

                .join('\n');


        if (available) {

            lines.push(
                'Available events:',
                available
            );
        }
    }


    /*
     * Explicit game protocol.
     *
     * This is intentionally concise.
     */

    lines.push(

        '',

        'GAME SIGNAL PROTOCOL:',

        '1. If an Available event clearly begins or is currently occurring in the scene, emit <game event="EVENT_ID"/> once to start it.',

        '2. If an Active event requires a player choice and the player clearly selects one listed choice, emit <game event="EVENT_ID" choice="CHOICE_ID"/>.',

        '3. Never invent event IDs, choice IDs, affection changes, time changes, stats, flags, or effects.',

        '4. Starting an event does not apply its effects. Only a valid choice resolves an event.',

        '5. If no game event is occurring, narrate normally without a game signal.',

        '6. The <game .../> signal is silent. Never mention the signal or game mechanics in the narrative.',

        '[/GAME]',
    );


    return lines.join('\n');
}


/* =========================================================
 * HUD
 * ========================================================= */

function _hudContent(
    state
) {

    if (!state) {

        return (
            '<span>' +
            'Tokimeki GS: waiting for first turn…' +
            '</span>'
        );
    }


    const c =
        state.calendar;


    const rel =
        Object.entries(
            state.relationships
        )

            .map(
                ([id, npc]) =>

                    `<span style="margin-right:10px">` +

                    `${escapeHtml(
                        npc.name || id
                    )}` +

                    ` ♥ ${npc.affection} · ` +

                    `${escapeHtml(
                        stageLabel(
                            npc.stage
                        )
                    )}` +

                    `</span>`
            )

            .join('');


    return `

        <div
            style="
                font-family:system-ui,sans-serif;
                font-size:12px;
                line-height:1.5;
            "
        >

            <div>

                <b>
                    Y${c.year} ·
                    ${c.month}/${c.day}
                </b>

                ·

                ${escapeHtml(
                    WEEKDAYS[
                        c.weekday
                    ] || ''
                )}

                ·

                ${escapeHtml(
                    c.period
                )}

            </div>

            <div
                style="margin-top:4px;"
            >

                ${
                    rel ||
                    'No relationships yet.'
                }

            </div>

        </div>

    `;
}


/* =========================================================
 * HTML ESCAPING
 * ========================================================= */

function escapeHtml(
    value
) {

    return String(
        value ?? ''
    )

        .replace(
            /&/g,
            '&amp;'
        )

        .replace(
            /</g,
            '&lt;'
        )

        .replace(
            />/g,
            '&gt;'
        )

        .replace(
            /"/g,
            '&quot;'
        )

        .replace(
            /'/g,
            '&#039;'
        );
}


/* =========================================================
 * STATEFULLORE MODULE
 * ========================================================= */

const TokimekiGS = {

    name:
        'Tokimeki Girls Side — Core',

    version:
        VERSION,


    /* -----------------------------------------------------
     * INITIALIZATION
     * ----------------------------------------------------- */

    init(data) {

        return normalizeState(
            data ||
            makeInitialState()
        );
    },


    /* -----------------------------------------------------
     * BEFORE GENERATION
     * ----------------------------------------------------- */

    processTurn({

        state,

        systemText,

        messages,

        charNameHint,

        personaName

    } = {}) {

        state =
            normalizeState(
                state
            );


        state.turn =
            (
                Number(
                    state.turn
                ) || 0
            ) + 1;


        /*
         * Special first-day school-arrival
         * detector.
         *
         * This is intentionally separate from
         * normal Available-event handling.
         */
        if (

            !state.events.active &&

            detectSchoolArrival(
                messages
            ) &&

            requirementsPass(
                EVENTS.school_arrival_rei_01,
                state
            )

        ) {

            beginEvent(
                state,
                'school_arrival_rei_01'
            );
        }


        /*
         * Capture persona name once.
         */
        if (

            personaName &&

            state.player.name ===
                '{{user}}'

        ) {

            state.player.name =
                personaName;
        }


        const header =
            buildCompactHeader(
                state
            );


        return {
            header,
            state,
        };
    },


    /* -----------------------------------------------------
     * AFTER GENERATION
     * ----------------------------------------------------- */

    handleResponse({

        assistantText,

        state

    } = {}) {

        state =
            normalizeState(
                state
            );


        const signals =
            parseGameSignals(
                assistantText
            );


        let cleanedText =
            assistantText;


        /*
         * Process signals in order.
         */
        for (
            const signal
            of signals
        ) {

            const eventId =
                signal.event;

            const choice =
                signal.choice;


            if (!eventId) {
                continue;
            }


            const event =
                getEvent(
                    eventId
                );


            /*
             * Unknown event IDs are ignored.
             */
            if (!event) {
                continue;
            }


            /*
             * -----------------------------------------
             * START EVENT
             *
             * <game event="event_id"/>
             * -----------------------------------------
             */

            if (!choice) {

                /*
                 * Never overwrite an already
                 * active event.
                 */

                if (
                    !state.events.active
                ) {

                    beginEvent(
                        state,
                        eventId
                    );
                }


                continue;
            }


            /*
             * -----------------------------------------
             * RESOLVE EVENT
             *
             * <game event="event_id"
             *       choice="choice_id"/>
             * -----------------------------------------
             */


            /*
             * Model cannot bypass lifecycle.
             *
             * If the requested event is not
             * currently active, ignore it.
             */

            if (
                state.events.active?.id !==
                eventId
            ) {

                continue;
            }


            resolveEvent(
                state,
                event,
                choice
            );
        }


        /*
         * Remove silent game tags from
         * displayed assistant text.
         */

        cleanedText =
            stripGameSignals(
                cleanedText
            );


        /*
         * Re-derive every relationship stage.
         *
         * Stage is never authoritative state.
         */
        for (
            const npc
            of Object.values(
                state.relationships
            )
        ) {

            npc.stage =
                stageForAffection(
                    npc.affection
                );
        }


        return {

            state,

            cleanedText,
        };
    },


    /* -----------------------------------------------------
     * HUD SUPPORT
     * ----------------------------------------------------- */

    _getHudContent() {

        return _hudContent(
            this._hudState
        );
    },


    getSettingsHtml(
        config
    ) {

        return `

            <div
                id="tokimeki-gs-hud"

                style="
                    padding:10px;
                    border:1px solid #777;
                    border-radius:10px;
                "
            >

                ${this._getHudContent()}

            </div>

        `;
    },


    updateHud(
        state,
        config
    ) {

        this._hudState =
            state;


        const el =
            document.getElementById(
                'tokimeki-gs-hud'
            );


        if (el) {

            el.innerHTML =
                this._getHudContent();
        }


        window
            ._tokimekiGSFloatRefresh
            ?.();
    },


    /* -----------------------------------------------------
     * DEBUG
     * ----------------------------------------------------- */

    getDebugInfo(
        state
    ) {

        const s =
            normalizeState(
                state
            );


        return JSON.stringify(

            {

                version:
                    VERSION,

                turn:
                    s.turn,

                calendar:
                    s.calendar,

                player:
                    s.player,

                relationships:
                    s.relationships,

                activeEvent:
                    s.events.active,

                completed:
                    s.events.completed,

                available:
                    getAvailableEvents(
                        s
                    ).map(
                        x => x.id
                    ),
            },

            null,

            2
        );
    },
};


export default TokimekiGS;
