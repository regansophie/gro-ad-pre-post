// ==================================================
// Initialize jsPsych
// ==================================================
const jsPsych = initJsPsych({
  on_finish: function() {
    jsPsych.data.displayData(); // for debugging; remove later
  }
});

// make a simple participant id (or pull from URL)
var subject_id = jsPsych.randomization.randomID(4);
// or: var subject_id = jsPsych.data.getURLVariable('id') || jsPsych.randomization.randomID(8);

jsPsych.data.addProperties({
  subject_id: subject_id
});


// ==================================================
// Global styles (run once)
// ==================================================
const gumballStyle = document.createElement("style");
gumballStyle.id = "gumball-style";
gumballStyle.innerHTML = `
  .gumball {
    position: absolute;
    border-radius: 50%;
    width: 10%;
    aspect-ratio: 1 / 1;
    transform: translate(-50%, -50%);
  }
  .gumball.green { background-color: #e53935; }
  .gumball.blue  { background-color: #1e40ff; }
`;
document.head.appendChild(gumballStyle);


// ==================================================
// Catch trial helpers
// ==================================================

// Marks exactly (nPresent + nAbsent) eligible trials with catch_probe=true,
// and sets catch_present=true for nPresent of those, false for the rest.
function assignCatchTrials(configList, nPresent, nAbsent) {
  const eligibleIdx = configList
    .map((cfg, idx) => (cfg.specialAlien && cfg.specialAlien !== 0 ? idx : null))
    .filter(idx => idx !== null);

  const nTotal = nPresent + nAbsent;
  if (eligibleIdx.length < nTotal) {
    console.warn(
      `assignCatchTrials: Not enough eligible trials (${eligibleIdx.length}) for requested ${nTotal}. Will probe fewer.`
    );
  }

  const probedIdx = jsPsych.randomization.sampleWithoutReplacement(
    eligibleIdx,
    Math.min(nTotal, eligibleIdx.length)
  );

  const presentIdx = new Set(
    jsPsych.randomization.sampleWithoutReplacement(
      probedIdx,
      Math.min(nPresent, probedIdx.length)
    )
  );

  probedIdx.forEach(idx => {
    configList[idx].catch_probe = true;
    configList[idx].catch_present = presentIdx.has(idx);
  });

  // (Optional) make it explicit for probed-but-not-present trials
  probedIdx.forEach(idx => {
    if (!presentIdx.has(idx)) configList[idx].catch_present = false;
  });

  return configList;
}

// Conditional catch question block that runs only when catch_probe===true
function makeCatchQuestionBlock(phaseLabel) {
  return {
    timeline: [{
      type: jsPsychHtmlButtonResponse,
      stimulus: `
        <div style="
          font-size:28px;
          text-align:center;
          padding-top:35vh;
          max-width:900px;
          margin:0 auto;
        ">
          On the previous page, did you see a <b>white plus sign</b> on the alien’s shirt?
        </div>
      `,
      choices: ["Yes", "No"],
      on_finish: function(data) {
        const present = jsPsych.timelineVariable("catch_present");
        const respYes = (data.response === 0);

        data.trial_type = "catch_question";
        data.catch_phase = phaseLabel;           // "exposure" or "prediction"
        data.catch_present = present;            // true/false
        data.catch_response = respYes ? "yes" : "no";
        data.catch_correct =
          (present === true && respYes) || (present === false && !respYes);
      }
    }],
    conditional_function: function() {
      return jsPsych.timelineVariable("catch_probe") === true;
    }
  };
}

// Helper: special alien HTML with optional white + overlay.
// The + is positioned around the shirt-ish region; adjust top if needed.
function specialAlienWithCrossHTML({ src, heightVh, catchPresent, yShift = 35 }) {
  return `
    <div style="
      position:absolute;
      bottom:100%;
      left:50%;
      transform:translate(-50%, ${yShift}%);
      height:${heightVh}vh;
      z-index:20;
      pointer-events:none;
    ">
      <div style="position:relative; height:100%;">
        <img src="${src}" style="height:100%; object-fit:contain; display:block;">
        ${catchPresent ? `
          <div style="
            position:absolute;
            top:62%;
            left:50%;
            transform:translate(-50%, -50%);
            color:white;
            font-size:5vh;
            font-weight:900;
            text-shadow: 0 0 6px rgba(0,0,0,0.85);
            pointer-events:none;
            user-select:none;
          ">+</div>
        ` : ""}
      </div>
    </div>
  `;
}


// ==================================================
// Helper: generate gumballs HTML
// ==================================================
function makeGumballsHTML(numGreen, numBlue) {
  let html = [];
  const balls = [];

  const BALL_RADIUS = 5;
  const EDGE_MARGIN = 4;
  const MIN_DIST_FACTOR = 1.2;

  const CIRCLE_CENTER = { x: 50, y: 50 };
  const CIRCLE_RADIUS = 50 - EDGE_MARGIN - BALL_RADIUS;
  const MIN_CENTER_DIST = 2 * BALL_RADIUS * MIN_DIST_FACTOR;

  function sampleNonOverlappingPosition() {
    let attempts = 0;

    while (attempts < 200) {
      const x = BALL_RADIUS + Math.random() * (100 - 2 * BALL_RADIUS);
      const y = BALL_RADIUS + Math.random() * (100 - 2 * BALL_RADIUS);

      const dx0 = x - CIRCLE_CENTER.x;
      const dy0 = y - CIRCLE_CENTER.y;
      const distFromCenter = Math.sqrt(dx0 * dx0 + dy0 * dy0);

      if (distFromCenter > CIRCLE_RADIUS) {
        attempts++;
        continue;
      }

      let ok = true;
      for (const b of balls) {
        const dx = x - b.x;
        const dy = y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < MIN_CENTER_DIST) {
          ok = false;
          break;
        }
      }

      if (ok) return { x, y };
      attempts++;
    }

    return { x: 50, y: 50 };
  }

  function addBalls(n, cls) {
    for (let i = 0; i < n; i++) {
      const pos = sampleNonOverlappingPosition();
      balls.push(pos);
      html.push(`
        <div class="gumball ${cls}"
             style="top:${pos.y}%; left:${pos.x}%;"></div>
      `);
    }
  }

  addBalls(numGreen, "green");
  addBalls(numBlue, "blue");

  return html.join("");
}


// ==================================================
// Animate gumballs inside the circular globe
// ==================================================
function startGumballAnimation(globeSelector = '#gumball-globe') {
  const globe = document.querySelector(globeSelector);
  if (!globe) return;

  const balls = Array.from(globe.querySelectorAll('.gumball'));
  if (balls.length === 0) return;

  const BALL_RADIUS = 5;
  const EDGE_MARGIN = 4;
  const CENTER_X = 50;
  const CENTER_Y = 50;
  const CIRCLE_RADIUS = 50 - EDGE_MARGIN - BALL_RADIUS;

  const SPEED = 0.23;

  const state = balls.map(el => {
    const x = parseFloat(el.style.left) || 50;
    const y = parseFloat(el.style.top)  || 50;
    const angle = Math.random() * 2 * Math.PI;
    const vx = SPEED * Math.cos(angle);
    const vy = SPEED * Math.sin(angle);
    return { el, x, y, vx, vy };
  });

  function step() {
    state.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;

      let dx = b.x - CENTER_X;
      let dy = b.y - CENTER_Y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      const maxDist = CIRCLE_RADIUS;

      if (dist > maxDist) {
        const nx = dx / dist;
        const ny = dy / dist;

        const dot = b.vx * nx + b.vy * ny;
        b.vx = b.vx - 2 * dot * nx;
        b.vy = b.vy - 2 * dot * ny;

        const overshoot = dist - maxDist;
        b.x -= nx * overshoot;
        b.y -= ny * overshoot;
      }

      b.el.style.left = b.x + '%';
      b.el.style.top  = b.y + '%';
    });

    globe._gumballAnimationFrame = requestAnimationFrame(step);
  }

  step();
}

function stopGumballAnimation(globeSelector = '#gumball-globe') {
  const globe = document.querySelector(globeSelector);
  if (!globe) return;
  if (globe._gumballAnimationFrame) {
    cancelAnimationFrame(globe._gumballAnimationFrame);
    globe._gumballAnimationFrame = null;
  }
}


// ==================================================
// Configs
// ==================================================
var gumball_configs_intro = [
  { numRed: 0,  numBlue: 0,  specialAlien: 0, headerText: "Here is a planet in outer space.", audio: null },
  { numRed: 0,  numBlue: 0,  specialAlien: 0, headerText: "These are the aliens who live there.", audio: null },
  { numRed: 0,  numBlue: 0,  specialAlien: 0, headerText: "These aliens love gumballs.", audio: null },
  { numRed: 15, numBlue: 15, specialAlien: 0, headerText: "Every day, new gumballs are delivered to their gumball machine.", audio: null },
  { numRed: 15, numBlue: 15, specialAlien: 0, headerText: "And one gumball comes out.", audio: null },
  { numRed: 15, numBlue: 15, specialAlien: 0, headerText: "The aliens get to add the one that comes out to their collection.", audio: null },
  { numRed: 15, numBlue: 15, specialAlien: 1, headerText: "One of the aliens goes up to check what is in the machine.", audio: null },
  { numRed: 15, numBlue: 15, specialAlien: 1, headerText: "He says how likely he thinks it is that the aliens will get a blue gumball.", audio: null }
];

var gumball_configs_intro_2 = [
  { numRed: 15, numBlue: 15, specialAlien: 0, headerText: "Now, let's see what the first alien says.", audio: null }
];


// speakerNumber: 1, 2, 3...
// threshold: proportion of BLUE at/above which we use "many" instead of "some"
function makeSpeakerGumballConfigs(speakerNumber, gender, threshold, specialAlien) {
  const baseRatios = [
    { numRed: 30, numBlue: 0,  specialAlien: specialAlien }, // 1.00

    { numRed: 27, numBlue: 3,  specialAlien: specialAlien }, // .9

    { numRed: 23, numBlue: 7,  specialAlien: specialAlien }, // .76
    { numRed: 23, numBlue: 7,  specialAlien: specialAlien },
    { numRed: 23, numBlue: 7,  specialAlien: specialAlien },

    { numRed: 18, numBlue: 12, specialAlien: specialAlien }, // .6
    { numRed: 18, numBlue: 12, specialAlien: specialAlien },
    { numRed: 18, numBlue: 12, specialAlien: specialAlien },

    { numRed: 15, numBlue: 15, specialAlien: specialAlien }, // .5
    { numRed: 15, numBlue: 15, specialAlien: specialAlien }, 
    { numRed: 15, numBlue: 15, specialAlien: specialAlien }, 

    { numRed: 12, numBlue: 18, specialAlien: specialAlien }, // .4 
    { numRed: 12, numBlue: 18, specialAlien: specialAlien },
    { numRed: 12, numBlue: 18, specialAlien: specialAlien },

    { numRed: 7,  numBlue: 23, specialAlien: specialAlien }, // .24 
    { numRed: 7,  numBlue: 23, specialAlien: specialAlien },
    { numRed: 7,  numBlue: 23, specialAlien: specialAlien },

    { numRed: 3,  numBlue: 27, specialAlien: specialAlien }, // .1

    { numRed: 0,  numBlue: 30, specialAlien: specialAlien }  // 0 
  ];

  let pronounPhrase;
  if (gender === "female") pronounPhrase = "She says";
  else if (gender === "male") pronounPhrase = "He says";


  const configs = baseRatios.map(r => {
    const total = r.numRed + r.numBlue;
    const propBlue = r.numBlue / total;
    const useMany = propBlue >= threshold;

    return {
      numRed: r.numRed,
      numBlue: r.numBlue,
      specialAlien: r.specialAlien,
      proportionBlue: propBlue,
      speakerNumber: speakerNumber,
      gender: gender
    };
  });

const repeated = []
  .concat(configs.map(c => ({ ...c })))
  .concat(configs.map(c => ({ ...c })))
  .concat(configs.map(c => ({ ...c })));

  return jsPsych.randomization.shuffle(configs);
}


const UTTERANCES = {
  BARE: {
    text: (pronoun="He") => `${pronoun}, "We will get a blue one."`,
    audio: speaker => `audio/${speaker}/bare.mp3`
  },
  MIGHT: {
    text: (pronoun="He") => `${pronoun}, "We might get a blue one."`,
    audio: speaker => `audio/${speaker}/might.mp3`
  },
  PROBABLY: {
    text: (pronoun="He") => `${pronoun}, "We will probably get a blue one."`,
    audio: speaker => `audio/${speaker}/probably.mp3`
  }
};

function makeTrialConfig({
  proportion,
  total = 30,
  target = "blue",
  utteranceType,
  speakerNumber,
  pronounPhrase = "He says",
  specialAlien
}) {
  const numTarget = Math.round(total * proportion);
  const numOther  = total - numTarget;

  const isBlueTarget = target === "blue";

  return {
    numBlue: isBlueTarget ? numTarget : numOther,
    numRed:  isBlueTarget ? numOther  : numTarget,
    specialAlien: specialAlien,
    headerText: UTTERANCES[utteranceType].text(pronounPhrase),
    audio: UTTERANCES[utteranceType].audio(speakerNumber),
    utteranceType: utteranceType,
    proportionBlue: isBlueTarget ? (numTarget / total) : (numOther / total),
    speakerNumber,
    targetColor: target
  };
}

function makeConditionConfigs(condition, speakerNumber, target="blue", speakerThreshold=0.60, gender="male", specialAlien) {
  let trials = [];

  let pronounPhrase;
  if (gender === "female") pronounPhrase = "She says";
  else if (gender === "male") pronounPhrase = "He says";

  function criticalUtterance(proportion) {
    if (condition === "confident") return (proportion >= speakerThreshold) ? "PROBABLY" : "MIGHT";
    if (condition === "cautious")  return (proportion >= speakerThreshold) ? "MIGHT" : "PROBABLY";
  }

  for (let i = 0; i < 10; i++) {
    trials.push(makeTrialConfig({
      proportion: speakerThreshold,
      utteranceType: criticalUtterance(speakerThreshold),
      speakerNumber,
      target,
      pronounPhrase,
      specialAlien
    }));
  }

  for (let i = 0; i < 3; i++) {
    trials.push(makeTrialConfig({
      proportion: 1.00,
      utteranceType: "BARE",
      speakerNumber,
      target,
      pronounPhrase,
      specialAlien
    }));
  }

  if (condition === "confident") {
    for (let i = 0; i < 7; i++) {
      trials.push(makeTrialConfig({
        proportion: 0.25,
        utteranceType: "MIGHT",
        speakerNumber,
        target,
        pronounPhrase,
        specialAlien
      }));
    }
  }

  if (condition === "cautious") {
    for (let i = 0; i < 7; i++) {
      trials.push(makeTrialConfig({
        proportion: 0.90,
        utteranceType: "PROBABLY",
        speakerNumber,
        target,
        pronounPhrase,
        specialAlien
      }));
    }
  }

  return jsPsych.randomization.shuffle(trials);
}


// ==================================================
// FACTORY: gumball pages (EXPOSURE) + catch question
// ==================================================
function makeGumballPages(configList) {
  return {
    timeline: [
      {
        type: jsPsychHtmlKeyboardResponse,

        data: function() {
          const special = jsPsych.timelineVariable('specialAlien');
          let speakerColor = null;

          if (special >= 1 && special <= 5) speakerColor = 'green';
          else if (special >= 6 && special <= 10) speakerColor = 'yellow';

          return {
            trial_type: "exposure",
            numRed: jsPsych.timelineVariable('numRed'),
            numBlue: jsPsych.timelineVariable('numBlue'),
            specialAlien: special,
            headerText: jsPsych.timelineVariable('headerText'),
            audio: jsPsych.timelineVariable('audio'),
            speakerNumber: jsPsych.timelineVariable('speakerNumber'),
            gender: jsPsych.timelineVariable('gender'),
            utteranceType: jsPsych.timelineVariable('utteranceType'),
            proportionBlue: jsPsych.timelineVariable('proportionBlue'),
            speakerColor: speakerColor,

            // catch bookkeeping (present even if undefined)
            catch_probe: jsPsych.timelineVariable('catch_probe'),
            catch_present: jsPsych.timelineVariable('catch_present')
          };
        },

        stimulus: function() {
          const numRed   = jsPsych.timelineVariable('numRed');
          const numBlue  = jsPsych.timelineVariable('numBlue');
          const special  = jsPsych.timelineVariable('specialAlien');
          const header   = jsPsych.timelineVariable('headerText');
          const catchPresent = jsPsych.timelineVariable('catch_present') === true;

          const gumballsHTML = makeGumballsHTML(numRed, numBlue);

          let specialGreenIdx = null;
          let specialYellowIdx = null;
          if (special >= 1 && special <= 5) specialGreenIdx = special;
          else if (special >= 6 && special <= 10) specialYellowIdx = special - 5;

          // LEFT: green aliens (fixed slots 1..4; leave blank if special)
          const leftAliensHTML = [1,2,3,4].map(i => {
            const isMissing = (i === specialGreenIdx);
            return isMissing
              ? `<img src="images/aliens/alien_green_${i}.png"
                     style="height:20vh; object-fit:contain; visibility:hidden;">`
              : `<img src="images/aliens/alien_green_${i}.png"
                     style="height:20vh; object-fit:contain;">`;
          }).join("");

          // RIGHT: yellow aliens (fixed slots 1..4; leave blank if special)
          const rightAliensHTML = [1,2,3,4].map(i => {
            const isMissing = (i === specialYellowIdx);
            return isMissing
              ? `<img src="images/aliens/alien_yellow_${i}.png"
                     style="height:16vh; object-fit:contain; visibility:hidden;">`
              : `<img src="images/aliens/alien_yellow_${i}.png"
                     style="height:16vh; object-fit:contain;">`;
          }).join("");

          // Special alien above machine, with optional +
          let specialAlienHTML = "";
          if (specialGreenIdx) {
            specialAlienHTML = specialAlienWithCrossHTML({
              src: `images/aliens/alien_green_${specialGreenIdx}.png`,
              heightVh: 17,
              catchPresent: catchPresent,
              yShift: 35
            });
          } else if (specialYellowIdx) {
            specialAlienHTML = specialAlienWithCrossHTML({
              src: `images/aliens/alien_yellow_${specialYellowIdx}.png`,
              heightVh: 16,
              catchPresent: catchPresent,
              yShift: 35
            });
          }

          return `
            <div style="position:fixed; inset:0; overflow:hidden;">

              <img src="images/background.png"
                   style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover;">

              <div style="
                position:absolute;
                top:8%;
                width:100%;
                text-align:center;
                font-size:3vw;
                max-font-size:36px;
                color:white;
                text-shadow: 3px 3px 6px rgba(0,0,0,0.7);
                z-index:2;
              ">
                ${header}
              </div>

              <div style="
                position:absolute;
                bottom:24%;
                left:50%;
                transform:translateX(-50%);
                width:80vw;
                display:grid;
                grid-template-columns: 1fr auto 1fr;
                align-items:flex-end;
                column-gap:1vw;
                z-index:2;
              ">
                <div style="
                  display:flex;
                  justify-content:flex-end;
                  align-items:flex-end;
                  gap:0.8vw;
                ">
                  ${leftAliensHTML}
                </div>

                <div style="
                  position:relative;
                  height:50vh;
                  display:flex;
                  align-items:flex-end;
                  justify-content:center;
                ">
                  <img src="images/gumball_machine_empty.png"
                       style="height:100%; object-fit:contain; display:block;">

                  <div id="gumball-globe" style="
                    position:absolute;
                    top:13%;
                    left:18%;
                    width:64%;
                    height:41%;
                    background:white;
                    border-radius:50%;
                    overflow:hidden;
                    z-index:10;
                  ">
                    ${gumballsHTML}
                  </div>

                  ${specialAlienHTML}
                </div>

                <div style="
                  display:flex;
                  justify-content:flex-start;
                  align-items:flex-end;
                  gap:0.8vw;
                ">
                  ${rightAliensHTML}
                </div>
              </div>

              <div style="
                position:absolute;
                bottom:5%;
                width:100%;
                display:flex;
                justify-content:center;
                z-index:5;
              ">
                <button id="nextButton"
                        style="font-size:30px; padding:12px 28px; border-radius:14px; cursor:pointer;">
                  Next ➡
                </button>
              </div>
            </div>
          `;
        },

        choices: "NO_KEYS",

        on_load: function() {
          const nextBtn   = document.getElementById("nextButton");
          const audioFile = jsPsych.timelineVariable('audio');

          function enableNextButton() {
            nextBtn.disabled = false;
            nextBtn.style.cursor = 'pointer';
            nextBtn.style.opacity = '1';
          }

          function disableNextButton() {
            nextBtn.disabled = true;
            nextBtn.style.cursor = 'not-allowed';
            nextBtn.style.opacity = '0.5';
          }

          nextBtn.onclick = () => {
            if (nextBtn.disabled) return;
            jsPsych.finishTrial();
          };

          // If you want to disable until audio ends, uncomment:
           disableNextButton();

          if (audioFile) {
            window.currentExposureAudio = new Audio(audioFile);

            window.currentExposureAudio.addEventListener('ended', () => {
              enableNextButton();
            });

            window.currentExposureAudio.play()
              .then(() => {})
              .catch(e => {
                console.warn("Audio play blocked or failed:", e);
                enableNextButton();
              });
          } else {
            enableNextButton();
          }

          startGumballAnimation('#gumball-globe');
        },

        on_finish: function() {
          if (window.currentExposureAudio) {
            window.currentExposureAudio.pause();
            window.currentExposureAudio = null;
          }
          stopGumballAnimation('#gumball-globe');
        }
      },

      // Catch question (only runs when catch_probe===true)
      makeCatchQuestionBlock("exposure")
    ],

    timeline_variables: configList
  };
}


function getPredictionCopy(gender) {
  if (gender === "self") {
    return {
      question: "What would you say about the likelihood of getting a blue gumball?",
      likelihoodPrompt: "How likely is it that you would say each of the following sentences?",
      mightLabel: `You would say, <b>“We might get a blue one.”</b>`,
      probablyLabel: `You would say, <b>“We will probably get a blue one.”</b>`,
      otherLabel: `You would say <b>something else.</b>`
    };
  }

  return {
    question: "What do you think this alien will say about the ikelihood of getting a blue gumballs?",
    likelihoodPrompt: "How likely do you think it is that the alien will say each of the following sentences?",
    mightLabel: `The alien will say, <b>“We might get a blue one.”</b>`,
    probablyLabel: `The alien will say, <b>“We will probably get a blue one.”</b>`,
    otherLabel: `The alien will say <b>something else.</b>`
  };
}


// ==================================================
// FACTORY: prediction trials + catch question
// (Updated to support self-prediction when gender === "self")
// ==================================================
function makePredictionTrials(configList) {
  return {
    timeline: [
      {
        type: jsPsychHtmlKeyboardResponse,

        data: function() {
          const special = jsPsych.timelineVariable('specialAlien');
          let speakerColor = null;

          if (special >= 1 && special <= 5) speakerColor = 'green';
          else if (special >= 6 && special <= 10) speakerColor = 'yellow';

          return {
            trial_type: "prediction",
            numRed: jsPsych.timelineVariable('numRed'),
            numBlue: jsPsych.timelineVariable('numBlue'),
            specialAlien: special,
            headerText: jsPsych.timelineVariable('headerText'),
            speakerNumber: jsPsych.timelineVariable('speakerNumber'),
            gender: jsPsych.timelineVariable('gender'),
            is_self_prediction: (jsPsych.timelineVariable('gender') === "self"),
            proportionBlue: jsPsych.timelineVariable('proportionBlue'),
            speakerColor: speakerColor,

            // catch bookkeeping
            catch_probe: jsPsych.timelineVariable('catch_probe'),
            catch_present: jsPsych.timelineVariable('catch_present')
          };
        },

        stimulus: function() {
          const numRed   = jsPsych.timelineVariable('numRed');
          const numBlue  = jsPsych.timelineVariable('numBlue');
          const special  = jsPsych.timelineVariable('specialAlien');
          const catchPresent = jsPsych.timelineVariable('catch_present') === true;

          const gender = jsPsych.timelineVariable('gender');
          const copy = getPredictionCopy(gender);

          const gumballsHTML = makeGumballsHTML(numRed, numBlue);

          let specialGreenIdx = null;
          let specialYellowIdx = null;
          if (special >= 1 && special <= 5) specialGreenIdx = special;
          else if (special >= 6 && special <= 10) specialYellowIdx = special - 5;

          // LEFT: green aliens (fixed slots 1..4)
          const leftAliensHTML = [1,2,3,4].map(i => {
            const isMissing = (i === specialGreenIdx);
            return isMissing
              ? `<img src="images/aliens/alien_green_${i}.png"
                      style="height:20vh; object-fit:contain; visibility:hidden;">`
              : `<img src="images/aliens/alien_green_${i}.png"
                      style="height:20vh; object-fit:contain;">`;
          }).join("");

          // RIGHT: yellow aliens (fixed slots 1..4)
          const rightAliensHTML = [1,2,3,4].map(i => {
            const isMissing = (i === specialYellowIdx);
            return isMissing
              ? `<img src="images/aliens/alien_yellow_${i}.png"
                      style="height:17vh; object-fit:contain; visibility:hidden;">`
              : `<img src="images/aliens/alien_yellow_${i}.png"
                      style="height:17vh; object-fit:contain;">`;
          }).join("");

          // Special alien above machine, with optional +
          let specialAlienHTML = "";
          if (specialGreenIdx) {
            specialAlienHTML = specialAlienWithCrossHTML({
              src: `images/aliens/alien_green_${specialGreenIdx}.png`,
              heightVh: 17,
              catchPresent: catchPresent,
              yShift: 40
            });
          } else if (specialYellowIdx) {
            specialAlienHTML = specialAlienWithCrossHTML({
              src: `images/aliens/alien_yellow_${specialYellowIdx}.png`,
              heightVh: 17,
              catchPresent: catchPresent,
              yShift: 40
            });
          }

          return `
              <div style="
              position:fixed;
              inset:0;
              overflow:hidden;
            ">

              <img src="images/background.png"
                   style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover;">

              <div style="
                position:absolute;
                top:6%;
                width:100%;
                text-align:center;
                font-size:3vw;
                max-font-size:36px;
                color:white;
                z-index:2;
              ">
                ${copy.question}
              </div>

              <div style="
                position:absolute;
                bottom:30%;
                left:50%;
                transform:translateX(-50%);
                width:80vw;
                display:grid;
                grid-template-columns: 1fr auto 1fr;
                align-items:flex-end;
                column-gap:1vw;
                z-index:2;
              ">

                <div style="display:flex; justify-content:flex-end; align-items:flex-end; gap:0.8vw;">
                  ${leftAliensHTML}
                </div>

                <div style="
                  position:relative;
                  bottom:.00001%;
                  height:50vh;
                  display:flex;
                  align-items:flex-end;
                  justify-content:center;
                ">
                  <img src="images/gumball_machine_empty.png"
                       style="height:100%; object-fit:contain; display:block;">

                  <div id="gumball-globe" style="
                    position:absolute;
                    top:13%;
                    left:18%;
                    width:64%;
                    height:41%;
                    background:white;
                    border-radius:50%;
                    overflow:hidden;
                    z-index:10;
                  ">
                    ${gumballsHTML}
                  </div>

                  ${specialAlienHTML}
                </div>

                <div style="display:flex; justify-content:flex-start; align-items:flex-end; gap:0.8vw;">
                  ${rightAliensHTML}
                </div>
              </div>

              <div style="
                position:absolute;
                bottom:3%;
                left:50%;
                transform:translateX(-50%);
                width:70vw;
                max-width:900px;
                background:rgba(255,255,255,0.9);
                padding:0px 0px 0px 0px;
                border-radius:16px;
                box-shadow:0 2px 6px rgba(0,0,0,0.2);
                z-index:5;
              ">
                <div style="font-size:14px; margin-bottom:6px; text-align:center;">
                  ${copy.likelihoodPrompt}
                </div>

                <div style="display:flex; flex-direction:column; gap:6px;">

                  <div style="display:flex; align-items:center; gap:4px;">
                    <div style="flex:1; font-size:12px;">
                      ${copy.mightLabel}
                    </div>
                    <input id="slider_might" type="range" min="0" max="100" value="0" style="flex:2;">
                    <div style="width:40px; text-align:right;">
                      <span id="value_might">0</span>
                    </div>
                  </div>

                  <div style="display:flex; align-items:center; gap:4px;">
                    <div style="flex:1; font-size:12px;">
                      ${copy.probablyLabel}
                    </div>
                    <input id="slider_probably" type="range" min="0" max="100" value="0" style="flex:2;">
                    <div style="width:40px; text-align:right;">
                      <span id="value_probably">0</span>
                    </div>
                  </div>

                  <div style="display:flex; align-items:center; gap:4px;">
                    <div style="flex:1; font-size:12px;">
                      ${copy.otherLabel}
                    </div>
                    <input id="slider_other" type="range" min="0" max="100" value="0" style="flex:2;">
                    <div style="width:40px; text-align:right;">
                      <span id="value_other">0</span>
                    </div>
                  </div>

                </div>

                <div style="margin-top:6px; text-align:center; font-size:14px;">
                  Total: <span id="total_value">0</span> / 100
                </div>
                <div id="sum_warning" style="margin-top:2px; text-align:center; color:#c62828; font-size:13px; display:none;">
                  Make sure the total adds up to 100.
                </div>

                <div style="margin-top:6px; display:flex; justify-content:center;">
                  <button id="nextButton"
                          style="font-size:18px; padding:6px 18px; border-radius:10px; cursor:not-allowed; opacity:0.5;">
                    Next ➡
                  </button>
                </div>
              </div>

            </div>
          `;
        },

        choices: "NO_KEYS",

        on_load: function() {
          const sMight    = document.getElementById('slider_might');
          const sProbably = document.getElementById('slider_probably');
          const sOther    = document.getElementById('slider_other');

          const vMight    = document.getElementById('value_might');
          const vProbably = document.getElementById('value_probably');
          const vOther    = document.getElementById('value_other');

          const totalSpan = document.getElementById('total_value');
          const warning   = document.getElementById('sum_warning');
          const nextBtn   = document.getElementById('nextButton');

          function updateDisplay() {
            const might    = parseInt(sMight.value, 10)    || 0;
            const probably = parseInt(sProbably.value, 10) || 0;
            const other    = parseInt(sOther.value, 10)    || 0;
            const total    = might + probably + other;

            vMight.textContent    = might;
            vProbably.textContent = probably;
            vOther.textContent    = other;
            totalSpan.textContent = total;

            if (total === 100) {
              warning.style.display = 'none';
              nextBtn.disabled = false;
              nextBtn.style.cursor = 'pointer';
              nextBtn.style.opacity = '1';
            } else {
              warning.style.display = 'block';
              nextBtn.disabled = true;
              nextBtn.style.cursor = 'not-allowed';
              nextBtn.style.opacity = '0.5';
            }
          }

          function handleSliderChange(which) {
            let might    = parseInt(sMight.value, 10)    || 0;
            let probably = parseInt(sProbably.value, 10) || 0;
            let other    = parseInt(sOther.value, 10)    || 0;

            let total = might + probably + other;

            if (total > 100) {
              const excess = total - 100;
              if (which === 'might') {
                might = Math.max(0, might - excess);
                sMight.value = might;
              } else if (which === 'probably') {
                probably = Math.max(0, probably - excess);
                sProbably.value = probably;
              } else if (which === 'other') {
                other = Math.max(0, other - excess);
                sOther.value = other;
              }
            }

            updateDisplay();
          }

          sMight.addEventListener('input',    () => handleSliderChange('might'));
          sProbably.addEventListener('input', () => handleSliderChange('probably'));
          sOther.addEventListener('input',    () => handleSliderChange('other'));

          updateDisplay();

          nextBtn.onclick = function() {
            const might    = parseInt(sMight.value, 10)    || 0;
            const probably = parseInt(sProbably.value, 10) || 0;
            const other    = parseInt(sOther.value, 10)    || 0;
            const total    = might + probably + other;
            if (total !== 100) return;

            jsPsych.finishTrial({
              pred_might:    might,
              pred_probably: probably,
              pred_other:    other,
              pred_total:    total
            });
          };

          startGumballAnimation('#gumball-globe');
        },

        on_finish: function() {
          stopGumballAnimation('#gumball-globe');
        }
      },

      // Catch question (only runs when catch_probe===true)
      makeCatchQuestionBlock("prediction")
    ],

    timeline_variables: configList
  };
}



// ==================================================
// Save data / end screens 
// ==================================================
var save_data = {
  type: jsPsychPipe,
  action: "save",
  experiment_id: "srGu9BU1Qb8Q",
  filename: function() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `sub-${timestamp}_gumballs_${subject_id}.csv`;
  },
  data_string: function() {
    return jsPsych.data.get().csv();
  }
};

var saving_screen = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: `
    <div style="font-size: 24px; text-align: center; color: white;">
      Saving your answers...<br><br>
      Please wait a moment and do not close this window.
    </div>
  `,
  choices: "NO_KEYS",
  trial_duration: 1000
};

var credit_instructions = {
  type: jsPsychHtmlKeyboardResponse,
  choices: ["Enter", " "],
  stimulus: `
    <div style="
      font-size: 24px;
      line-height: 1.4;
      color: black;
      max-width: 800px;
      margin: 0 auto;
      padding-top: 10%;
      text-align: center;
    ">
      <p>Thank you for participating!</p>
      <p>To receive credit, please click the link below and enter your name.</p>
      <p style="margin-top:20px;">
        <a href="https://forms.gle/3Vk7e4CqKtZkYok49"
           target="_blank"
           style="color:#ffd166; font-size:26px; text-decoration:underline;">
           → Click here to submit your name for RPP credit ←
        </a>
      </p>
      <p style="margin-top:30px; font-size:20px; opacity:0.9;">
        After completing the form, you are finished with the experiment.
      </p>
    </div>
  `
};

var opening_instructions = {
  type: jsPsychHtmlButtonResponse,
  stimulus: `
    <div style="
      font-size: 24px;
      line-height: 1.4;
      color: black;
      max-width: 800px;
      margin: 0 auto;
      padding-top: 10%;
      text-align: center;
    ">
      //<p>
        This study will probably take you less than ten minutes.
        Please do not rush. Your answers are very important research data.
      </p>
      <p style="margin-top: 20px;">
        To receive credit, you will be given a link to a Google Form
        <strong>at the END of this experiment</strong>.
      </p>
      <p style="margin-top: 20px;">
        After this page, you will see a consent form. Once you give consent, the experiment will begin.
      </p>
      <p style="margin-top: 20px;">Click Next to begin.</p>
    </div>
  `,
  choices: ["Next →"],
  button_html: `
    <button class="jspsych-btn" style="
      font-size: 22px;
      padding: 12px 24px;
      margin-top: 30px;
      border-radius: 10px;
      cursor: pointer;
    ">%choice%</button>`
};

var opening_instructions_prolific = {
  type: jsPsychHtmlButtonResponse,
  stimulus: `
    <div style="
      font-size: 24px;
      line-height: 1.4;
      color: black;
      max-width: 800px;
      margin: 0 auto;
      padding-top: 10%;
      text-align: center;
    ">
      <p style="margin-top: 20px;">
        After this page, you will see a consent form. Once you give consent, the experiment will begin.
      </p>
      <p style="margin-top: 20px;">Click Next to begin.</p>
    </div>
  `,
  choices: ["Next →"],
  button_html: `
    <button class="jspsych-btn" style="
      font-size: 22px;
      padding: 12px 24px;
      margin-top: 30px;
      border-radius: 10px;
      cursor: pointer;
    ">%choice%</button>`
};

var consent_block = {
  timeline: [
    { type: jsPsychImageButtonResponse, stimulus: 'consent form/consentFormPt1.jpg', choices: ['Next'] },
    { type: jsPsychImageButtonResponse, stimulus: 'consent form/consentFormPt2.jpg', choices: ['Next'] },
    { type: jsPsychImageButtonResponse, stimulus: 'consent form/consentFormPt3.jpg', choices: ['Next'] },
    { type: jsPsychImageButtonResponse, stimulus: 'consent form/consentFormPt4.jpg', choices: ['Next'] },
    {
      type: jsPsychImageButtonResponse,
      stimulus: 'consent form/consentFormPt5.jpg',
      choices: ['I consent', 'I do not consent'],
      prompt: "<p>Do you consent to participating in this experiment?</p>"
    }
  ]
};

var prolific_id_page = {
  type: jsPsychSurveyText,
  questions: [{
    prompt: `
      <div style="font-size:22px; text-align:center; margin-bottom:20px;">
        Please enter your Prolific ID.
      </div>
    `,
    placeholder: "Enter your Prolific ID here",
    required: true,
    name: "prolific_id"
  }],
  button_label: "Submit",
  on_finish: function(data) {
    jsPsych.data.addProperties({
      prolific_id: data.response.prolific_id
    });
  }
};

var prolific_completion_page = {
  type: jsPsychHtmlKeyboardResponse,
  choices: "NO_KEYS",
  stimulus: `
    <div style="
      font-size: 24px;
      line-height: 1.5;
      color: black;
      max-width: 800px;
      margin: 0 auto;
      padding-top: 10%;
      text-align: center;
    ">
      <p>Thank you for participating!</p>
      <p style="margin-top: 20px;">Your Prolific completion code is:</p>
      <p style="margin-top: 10px; font-size: 32px; font-weight: bold;">
        <code>C4LMH6MP</code>
      </p>
      <p style="margin-top: 30px;">
        You can now return to Prolific and enter this code.<br>
        When you are done, you may close this window.
      </p>
    </div>
  `
};


// ==================================================
// Misc configs (unchanged)
// ==================================================
var transition_configs = [{
  numRed: 0,
  numBlue: 0,
  specialAlien: 0,
  headerText: "Now, a new alien will describe the machine.",
  audio: null
}];

var pre_prediction_configs = [{
  numRed: 0,
  numBlue: 0,
  specialAlien: 0,
  headerText: "Next, you will see a new alien, and you will guess what he will say.",
  audio: null
}];

var pre_prediction_configs_same_1 = [{
  numRed: 0,
  numBlue: 0,
  specialAlien: 2,
  headerText: "You have now seen this alien talk for a while.",
  audio: null
}];

var pre_prediction_configs_same_2 = [{
  numRed: 0,
  numBlue: 0,
  specialAlien: 2,
  headerText: "Now, you will guess what he is going to say.",
  audio: null
}];

var self_response_configs = [{
  numRed: 0,
  numBlue: 0,
  specialAlien: 0,
  headerText: "Now, we want to know what you would say in each situation.",
  audio: null
},
{
  numRed: 0,
  numBlue: 0,
  specialAlien: 0,
  headerText: "Think about how you would personally describe the likelihood.",
  audio: null
}];

const IMAGE_PRELOAD = [
  "images/background.png",
  "images/gumball_machine_empty.png",
  ...Array.from({ length: 4 }, (_, i) => `images/aliens/alien_green_${i + 1}.png`),
  ...Array.from({ length: 4 }, (_, i) => `images/aliens/alien_yellow_${i + 1}.png`),
];

const preload_images = {
  type: jsPsychPreload,
  images: IMAGE_PRELOAD,
  show_progress_bar: true,
  message: "Loading images…",
};

// ==================================================
// Assign to one condition
// ==================================================
var condition = jsPsych.randomization.sampleWithoutReplacement([1,2,3], 1)[0];
jsPsych.data.addProperties({ prediction_condition: condition });

var speaker_con = jsPsych.randomization.sampleWithoutReplacement([0,1], 1)[0];
jsPsych.data.addProperties({ speaker_condition: speaker_con });

if(speaker_con == 0){
  var bias = "cautious"
}else{
  var bias = "confident"
}



// ==================================================
// Build trial lists
// ==================================================
var speaker_same       = makeSpeakerGumballConfigs(2, "male", .31, 2);
var speaker_diff_group = makeSpeakerGumballConfigs(5, "male", .41, 7);
var speaker_same_group = makeSpeakerGumballConfigs(5, "male", .41, 4);

var speaker_self = makeSpeakerGumballConfigs(0, "self", .41, 0);

var configs_s1 = makeConditionConfigs(bias, "brian",   "blue", 0.6, "male",   2);
var configs_s2 = makeConditionConfigs(bias, "jessica", "blue", 0.6, "female", 3);
var configs_s3 = makeConditionConfigs(bias, "bill",    "blue", 0.6, "male",   7);


// ==================================================
// INTEGRATE CATCH TRIAL ASSIGNMENTS
// Currently, 1 yes and 1 no 
// ==================================================

// Exposure phase catch trials (only configs that are actual exposure trials)
assignCatchTrials(configs_s1, 1, 1);
assignCatchTrials(configs_s2, 1, 1);
assignCatchTrials(configs_s3, 1, 1);

// Prediction/test phase catch trials (whichever speaker list is used)
assignCatchTrials(speaker_same, 1, 1);
assignCatchTrials(speaker_diff_group, 1, 1);
assignCatchTrials(speaker_same_group, 1, 1);
assignCatchTrials(speaker_self, 1, 1);


// ==================================================
// Build timeline
// ==================================================
const timeline = [];
console.log(condition);
console.log(speaker_con);

timeline.push(preload_images);

// Uncomment for RPP
// timeline.push(opening_instructions);


// Uncomment for Prolific
 timeline.push(prolific_id_page);
 timeline.push(opening_instructions_prolific);


timeline.push(consent_block);

timeline.push(makeGumballPages(gumball_configs_intro));


timeline.push(makeGumballPages(self_response_configs));
timeline.push(makePredictionTrials(speaker_self));


if (condition == 1 || condition == 2 || condition == 3) {
  timeline.push(makeGumballPages(gumball_configs_intro_2));
  timeline.push(makeGumballPages(configs_s1)); // group 1 exposure
}

// baseline 
 if (condition == 0) {
   timeline.push(makeGumballPages(pre_prediction_configs));
   timeline.push(makePredictionTrials(speaker_same));
 }

if (condition === 1) {
  timeline.push(makeGumballPages(pre_prediction_configs));
  timeline.push(makePredictionTrials(speaker_diff_group));
}

if (condition === 2) {
  timeline.push(makeGumballPages(pre_prediction_configs));
  timeline.push(makePredictionTrials(speaker_same_group));
}

if (condition === 3) {
  timeline.push(makeGumballPages(pre_prediction_configs_same_1));
  timeline.push(makeGumballPages(pre_prediction_configs_same_2));
  timeline.push(makePredictionTrials(speaker_same));
}

timeline.push(makeGumballPages(self_response_configs));
timeline.push(makePredictionTrials(speaker_self));

timeline.push(saving_screen);
timeline.push(save_data);

// Uncomment for Prolific
timeline.push(prolific_completion_page);

// Uncomment for RPP
// timeline.push(credit_instructions);


// ==================================================
// Run
// ==================================================
jsPsych.run(timeline);
