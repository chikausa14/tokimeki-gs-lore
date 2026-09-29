/*
 * Tokimeki Girls Side — StatefulLore Core v0.1
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
 */

const VERSION = '0.1.3';

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
    'Sunday', 'Monday', 'Tuesday', 'Wednesday',
    'Thursday', 'Friday', 'Saturday'
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

    // 0. Testable school-arrival encounter.
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
            choices: ['greet', 'keep_walking'],
        },

        effects: {
            greet: {
                affection: { rei: +1 },
            },

            keep_walking: {},
        },

        time: 0,
    },

    // 1. Encounter — lightweight hallway/random encounter.
    hallway_rei_01: {
        id: 'hallway_rei_01',
        type: 'encounter',
        target: 'rei',

        requirements: s =>
            isSchoolDay(s) &&
            !s.events.completed.hallway_rei_01,

        flow: {
            choices: ['greet', 'pass_by'],
        },

        effects: {
            greet: {
                affection: { rei: +1 },
            },
        },

        time: 0,
    },

    // 2. Normal activity — engine owns the time cost.
    after_school_free_01: {
        id: 'after_school_free_01',
        type: 'activity',

        requirements: s =>
            s.calendar.period === 'after_school',

        flow: {
            choices: ['study', 'club', 'go_home'],
        },

        effects: {
            study: {
                player: { academics: +1 },
                time: 1,
            },

            club: {
                player: { clubs: +1 },
                time: 1,
            },

            go_home: {
                time: 1,
            },
        },
    },

    // 3. Scheduled school event.
    school_festival_01: {
        id: 'school_festival_01',
        type: 'scheduled',

        requirements: s =>
            isSchoolDay(s) &&
            s.calendar.month === s.world.schoolFestival.month &&
            s.calendar.day === s.world.schoolFestival.day &&
            !s.events.completed.school_festival_01,

        flow: {
            choices: ['attend', 'help'],
        },

        effects: {
            attend: {
                player: { festival: +1 },
                time: 2,
            },

            help: {
                player: { festival: +2 },
                time: 2,
            },
        },
    },

    // 4. Date — selectable location, then resolution.
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
            choices: ['cafe', 'arcade', 'park'],
        },

        effects: {
            cafe: {
                affection: { rei: +4 },
                time: 2,
            },

            arcade: {
                affection: { rei: +3 },
                time: 2,
            },

            park: {
                affection: { rei: +2 },
                time: 2,
            },
        },
    },

    // 5. Special route event.
    rei_special_01: {
        id: 'rei_special_01',
        type: 'special',
        target: 'rei',

        requirements: s =>
            s.relationships.rei.affection >= 30 &&
            !!s.relationships.rei.flags.firstDate &&
            !s.events.completed.rei_special_01,

        flow: {
            choices: ['talk', 'leave'],
        },

        effects: {
            talk: {
                affection: { rei: +5 },

                relationFlags: {
                    rei: {
                        specialEvent01: true,
                    },
                },
            },

            leave: {},
        },
    },
};


function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}


function stageForAffection(value) {
    const n = clamp(Number(value) || 0, 0, 100);

    return (
        STAGE_NAMES.find(
            x => n >= x.min && n <= x.max
        )?.id ||
        'stranger'
    );
}


function stageLabel(id) {
    return (
        STAGE_NAMES.find(x => x.id === id)?.label ||
        id
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
    const leap = isLeapGameYear(Number(year) || 1);

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


// The dating sim uses its own fictional calendar.
// Y1 4/1 is Monday.
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
                days += daysInMonth(y, mm);
            }

            days += d - anchorDay;

        } else {

            for (
                let mm = m;
                mm < anchorMonth;
                mm++
            ) {
                days -= daysInMonth(y, mm);
            }

            days += d - anchorDay;
        }

    } else {

        days += daysInMonth(1, 4) - 1;

        for (
            let mm = 5;
            mm <= 12;
            mm++
        ) {
            days += daysInMonth(1, mm);
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
            days += daysInMonth(y, mm);
        }

        days += d - 1;
    }

    return (
        ((1 + days) % 7 + 7) % 7
    );
}


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
            structuredClone(DEFAULT_NPCS),

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


function normalizeState(raw) {

    const base = makeInitialState();

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


    // Weekday is derived state.
    out.calendar.weekday =
        weekdayFor(
            Number(out.calendar.year) || 1,
            Number(out.calendar.month) || 4,
            Number(out.calendar.day) || 1
        );


    out.calendar.period =
        TIME_BLOCKS.includes(
            out.calendar.period
        )
            ? out.calendar.period
            : 'morning';


    for (
        const [id, npc]
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
                Number(npc.affection) || 0,
                0,
                100
            );


        npc.flags =
            npc.flags &&
            typeof npc.flags === 'object'
                ? npc.flags
                : {};


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


function getEvent(id) {
    return EVENTS[id] || null;
}


function requirementsPass(
    event,
    state
) {

    try {

        return !!event?.requirements?.(
            state
        );

    } catch {

        return false;
    }
}


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
                target: event.target || null,
                choices:
                    event.flow?.choices || [],
            })
        );
}


function findActiveEvent(state) {

    const id =
        state.events.active?.id;

    return id
        ? getEvent(id)
        : null;
}


function detectSchoolArrival(messages) {

    const lastUser =
        [...(messages || [])]
            .reverse()
            .find(
                m =>
                    m?.role === 'user'
            );


    if (!lastUser?.content) {
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
        p =>
            t.includes(p)
    );
}


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


    while (remaining-- > 0) {

        const currentIndex =
            TIME_BLOCKS.indexOf(
                state.calendar.period
            );


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


        // Evening -> next morning.
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


function applyPlayerEffects(
    state,
    changes = {}
) {

    for (
        const [key, delta]
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
        const [id, delta]
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
        const [id, flags]
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


function applyEventChoice(
    state,
    event,
    choice
) {

    const effects =
        event.effects?.[choice];


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
            event.target || null,

        choices: [
            ...(event.flow?.choices || [])
        ],
    };


    return true;
}


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


    if (
        state.events.active.id !==
        event.id
    ) {

        return false;
    }


    if (
        !event.flow?.choices?.includes(
            choice
        )
    ) {

        return false;
    }


    if (
        !applyEventChoice(
            state,
            event,
            choice
        )
    ) {

        return false;
    }


    state.events.completed[
        event.id
    ] = true;


    if (
        event.target === 'rei' &&
        event.type === 'date'
    ) {

        state.relationships.rei.flags.firstDate =
            true;
    }


    state.events.active = null;

    return true;
}


function parseGameSignals(text) {

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

            attrs[a[1]] = a[2];
        }


        if (
            attrs.event ||
            attrs.choice
        ) {

            signals.push(attrs);
        }
    }


    return signals;
}


function stripGameSignals(text) {

    return String(text || '')

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


function formatCalendar(c) {

    const wd =
        WEEKDAYS[c.weekday] || '?';


    return (
        `Y${c.year} ${c.month}/${c.day} ` +
        `${wd} | ${c.period}`
    );
}


function buildCompactHeader(state) {

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

            ? `Active: ${active.id} | choose: ${active.flow.choices.join(' | ')}`

            : 'Active: none',
    ];


    if (!active) {

        const available =
            getAvailableEvents(state)

                .slice(0, 5)

                .map(
                    e => e.id
                )

                .join(' | ');


        if (available) {

            lines.push(
                `Available: ${available}`
            );
        }
    }


    /*
     * IMPORTANT:
     *
     * This is the LLM <-> engine handshake.
     *
     * When an event is active, the model must emit
     * exactly one valid game signal when the user's
     * action clearly resolves one of the listed choices.
     *
     * The model does NOT calculate effects.
     * StatefulLore does that after receiving the signal.
     */

    if (active) {

        lines.push(

            'ACTIVE EVENT PROTOCOL:',

            'The current event is mechanically active.',

            'The listed choose values are the only valid mechanical choices.',

            'When the user clearly performs one listed choice, narrate the consequence naturally and emit exactly one matching signal:',

            `<game event="${active.id}" choice="CHOICE_ID"/>`,

            'Replace CHOICE_ID with exactly one of the listed choice IDs.',

            'Do not invent event IDs or choice IDs.',

            'Do not output affection changes, stat changes, time changes, flags, relationship stages, or other mechanical effects yourself.',

            'If the user has not yet performed a listed choice, continue the scene naturally and do not resolve the event yet.',
        );

    } else {

        lines.push(

            'No event is currently active.',

            'Narrate normally unless a valid game action or event signal is explicitly required.',
        );
    }


    lines.push(

        'The <game .../> signal is an internal mechanical instruction and will be removed before the player sees the final response.',

        '[/GAME]',
    );


    return lines.join('\n');
}


function _hudContent(state) {

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

        <div style="
            font-family:system-ui,sans-serif;
            font-size:12px;
            line-height:1.5;
        ">

            <div>

                <b>
                    Y${c.year} ·
                    ${c.month}/${c.day}
                </b>

                ·

                ${escapeHtml(
                    WEEKDAYS[c.weekday] || ''
                )}

                ·

                ${escapeHtml(
                    c.period
                )}

            </div>

            <div style="margin-top:4px;">

                ${
                    rel ||
                    'No relationships yet.'
                }

            </div>

        </div>
    `;
}


function escapeHtml(value) {

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


const TokimekiGS = {

    name:
        'Tokimeki Girls Side — Core',

    version:
        VERSION,


    init(data) {

        return normalizeState(
            data ||
            makeInitialState()
        );
    },


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
                Number(state.turn) || 0
            ) + 1;


        /*
         * Same-turn school-arrival trigger.
         *
         * This is only the prototype trigger.
         * Later the event system itself will become
         * calendar/event driven rather than relying
         * on phrase detection.
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


        if (

            personaName &&

            state.player.name === '{{user}}'

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
                getEvent(eventId);


            if (!event) {
                continue;
            }


            /*
             * Two-step protocol:
             *
             * <game event="EVENT_ID"/>
             *
             * starts an event.
             *
             * <game event="EVENT_ID" choice="CHOICE_ID"/>
             *
             * resolves an active event.
             */

            if (!choice) {

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
             * The model cannot bypass the
             * active-event lifecycle.
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


        cleanedText =
            stripGameSignals(
                cleanedText
            );


        /*
         * Keep all derived relationship
         * stages authoritative.
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


    _getHudContent() {

        return _hudContent(
            this._hudState
        );
    },


    getSettingsHtml(config) {

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


    getDebugInfo(state) {

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
                    getAvailableEvents(s)
                        .map(
                            x => x.id
                        ),
            },

            null,

            2
        );
    },
};


export default TokimekiGS;
