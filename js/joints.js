/**
 * joints.js — Joint definitions (model-local 3D space)
 * Model dinormalisasi: 2 unit tinggi, feet di y=0, center X=0, Z=0
 * localX: kiri=negatif, kanan=positif
 * localY: 0=bawah, 2=atas
 * localZ: depan=positif, belakang=negatif
 * type: 'y'=kuning(utama), 'c'=cyan(sekunder), 'g'=hijau(tulang belakang)
 */
'use strict';

const BodyJointDefs = [
  // ── Tulang Belakang (center) ──────────────────────────────────
  { id:'hips',        label:'Hips',         type:'y', group:'spine',  localX:0,     localY:1.02, localZ:0,    parent:null,          mirror:null          },
  { id:'spine1',      label:'Spine 1',      type:'g', group:'spine',  localX:0,     localY:1.20, localZ:0,    parent:'hips',        mirror:null          },
  { id:'spine2',      label:'Spine 2',      type:'g', group:'spine',  localX:0,     localY:1.37, localZ:0,    parent:'spine1',      mirror:null          },
  { id:'chest',       label:'Chest',        type:'g', group:'spine',  localX:0,     localY:1.55, localZ:0,    parent:'spine2',      mirror:null          },
  { id:'neck',        label:'Neck',         type:'g', group:'spine',  localX:0,     localY:1.73, localZ:0,    parent:'chest',       mirror:null          },
  { id:'head',        label:'Head',         type:'y', group:'spine',  localX:0,     localY:1.90, localZ:0,    parent:'neck',        mirror:null          },

  // ── Lengan Kiri ───────────────────────────────────────────────
  { id:'l_shoulder',  label:'L Shoulder',   type:'y', group:'arm_l',  localX:-0.21, localY:1.60, localZ:0,    parent:'chest',       mirror:'r_shoulder'  },
  { id:'l_upper_arm', label:'L Upper Arm',  type:'c', group:'arm_l',  localX:-0.38, localY:1.54, localZ:0,    parent:'l_shoulder',  mirror:'r_upper_arm' },
  { id:'l_elbow',     label:'L Elbow',      type:'y', group:'arm_l',  localX:-0.56, localY:1.37, localZ:0,    parent:'l_upper_arm', mirror:'r_elbow'     },
  { id:'l_forearm',   label:'L Forearm',    type:'c', group:'arm_l',  localX:-0.64, localY:1.20, localZ:0,    parent:'l_elbow',     mirror:'r_forearm'   },
  { id:'l_wrist',     label:'L Wrist',      type:'y', group:'arm_l',  localX:-0.73, localY:1.02, localZ:0,    parent:'l_forearm',   mirror:'r_wrist'     },

  // ── Lengan Kanan ──────────────────────────────────────────────
  { id:'r_shoulder',  label:'R Shoulder',   type:'y', group:'arm_r',  localX: 0.21, localY:1.60, localZ:0,    parent:'chest',       mirror:'l_shoulder'  },
  { id:'r_upper_arm', label:'R Upper Arm',  type:'c', group:'arm_r',  localX: 0.38, localY:1.54, localZ:0,    parent:'r_shoulder',  mirror:'l_upper_arm' },
  { id:'r_elbow',     label:'R Elbow',      type:'y', group:'arm_r',  localX: 0.56, localY:1.37, localZ:0,    parent:'r_upper_arm', mirror:'l_elbow'     },
  { id:'r_forearm',   label:'R Forearm',    type:'c', group:'arm_r',  localX: 0.64, localY:1.20, localZ:0,    parent:'r_elbow',     mirror:'l_forearm'   },
  { id:'r_wrist',     label:'R Wrist',      type:'y', group:'arm_r',  localX: 0.73, localY:1.02, localZ:0,    parent:'r_forearm',   mirror:'l_wrist'     },

  // ── Kaki Kiri ─────────────────────────────────────────────────
  { id:'l_hip',       label:'L Hip',        type:'y', group:'leg_l',  localX:-0.12, localY:1.00, localZ:0,    parent:'hips',        mirror:'r_hip'       },
  { id:'l_thigh',     label:'L Thigh',      type:'c', group:'leg_l',  localX:-0.14, localY:0.78, localZ:0,    parent:'l_hip',       mirror:'r_thigh'     },
  { id:'l_knee',      label:'L Knee',       type:'y', group:'leg_l',  localX:-0.15, localY:0.55, localZ:0,    parent:'l_thigh',     mirror:'r_knee'      },
  { id:'l_shin',      label:'L Shin',       type:'c', group:'leg_l',  localX:-0.15, localY:0.35, localZ:0,    parent:'l_knee',      mirror:'r_shin'      },
  { id:'l_ankle',     label:'L Ankle',      type:'y', group:'leg_l',  localX:-0.15, localY:0.12, localZ:0,    parent:'l_shin',      mirror:'r_ankle'     },
  { id:'l_foot',      label:'L Foot',       type:'c', group:'leg_l',  localX:-0.14, localY:0.05, localZ:0.07, parent:'l_ankle',     mirror:'r_foot'      },
  { id:'l_toe',       label:'L Toe',        type:'c', group:'leg_l',  localX:-0.13, localY:0.02, localZ:0.14, parent:'l_foot',      mirror:'r_toe'       },

  // ── Kaki Kanan ────────────────────────────────────────────────
  { id:'r_hip',       label:'R Hip',        type:'y', group:'leg_r',  localX: 0.12, localY:1.00, localZ:0,    parent:'hips',        mirror:'l_hip'       },
  { id:'r_thigh',     label:'R Thigh',      type:'c', group:'leg_r',  localX: 0.14, localY:0.78, localZ:0,    parent:'r_hip',       mirror:'l_thigh'     },
  { id:'r_knee',      label:'R Knee',       type:'y', group:'leg_r',  localX: 0.15, localY:0.55, localZ:0,    parent:'r_thigh',     mirror:'l_knee'      },
  { id:'r_shin',      label:'R Shin',       type:'c', group:'leg_r',  localX: 0.15, localY:0.35, localZ:0,    parent:'r_knee',      mirror:'l_shin'      },
  { id:'r_ankle',     label:'R Ankle',      type:'y', group:'leg_r',  localX: 0.15, localY:0.12, localZ:0,    parent:'r_shin',      mirror:'l_ankle'     },
  { id:'r_foot',      label:'R Foot',       type:'c', group:'leg_r',  localX: 0.14, localY:0.05, localZ:0.07, parent:'r_ankle',     mirror:'l_foot'      },
  { id:'r_toe',       label:'R Toe',        type:'c', group:'leg_r',  localX: 0.13, localY:0.02, localZ:0.14, parent:'r_foot',      mirror:'l_toe'       },
];

// Mirror map (id -> mirror id)
const BoneMirrors = {};
BodyJointDefs.forEach(d => { if (d.mirror) BoneMirrors[d.id] = d.mirror; });

// ── Hand Joint Definitions ────────────────────────────────────────
function _handDefs(side) {
  const S    = side === 'left' ? -1 : 1;
  const pref = side === 'left' ? 'l_' : 'r_';
  const lbl  = side === 'left' ? 'L'  : 'R';
  const WX   = S * 0.73;
  const WY   = 1.02;
  const grp  = 'hand_' + side[0];

  const joints = [
    { id:`${pref}palm`, label:`${lbl} Palm`, type:'y', localX: WX, localY: WY, localZ: 0.02 },
  ];

  const fingers = [
    { n:'thumb',  bx: S*0.77, by: WY, chains:[[0, 0.04, 0.05],[0, 0.04, 0.09],[0, 0.03, 0.12]] },
    { n:'index',  bx: S*0.84, by: WY, chains:[[0,-0.03, 0.06],[0,-0.03, 0.10],[0,-0.02, 0.13]] },
    { n:'middle', bx: S*0.86, by: WY, chains:[[0,-0.01, 0.06],[0,-0.01, 0.11],[0,-0.01, 0.14]] },
    { n:'ring',   bx: S*0.84, by: WY, chains:[[0, 0.01, 0.06],[0, 0.01, 0.10],[0, 0.01, 0.13]] },
    { n:'pinky',  bx: S*0.80, by: WY, chains:[[0, 0.03, 0.05],[0, 0.03, 0.08],[0, 0.03, 0.11]] },
  ];
  const jNames = ['mcp','pip','dip'];

  fingers.forEach(f => {
    f.chains.forEach((off, i) => {
      joints.push({
        id:     `${pref}${f.n}_${jNames[i]}`,
        label:  `${lbl} ${f.n.charAt(0).toUpperCase()+f.n.slice(1)} ${jNames[i].toUpperCase()}`,
        type:   'c',
        localX: f.bx + off[0],
        localY: f.by + off[1],
        localZ: off[2],
        group:  grp,
        parent: i === 0 ? `${pref}palm` : `${pref}${f.n}_${jNames[i-1]}`,
      });
    });
  });

  return joints.map(j => ({ ...j, group: grp }));
}

const HandJointDefsLeft  = _handDefs('left');
const HandJointDefsRight = _handDefs('right');

window.BodyJointDefs      = BodyJointDefs;
window.HandJointDefsLeft  = HandJointDefsLeft;
window.HandJointDefsRight = HandJointDefsRight;
window.BoneMirrors        = BoneMirrors;