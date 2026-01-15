export enum RobotState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  THINKING = 'THINKING',
  TALKING = 'TALKING',
  RECHARGING = 'RECHARGING', // New State untuk Auto-Retry
  ERROR = 'ERROR'
}

export interface RobotAssets {
  head: string;
  body: string;
  armLeft: string;
  armRight: string;
  legLeft: string;
  legRight: string;
  eyeNormal: string;
  eyeHappy: string;
  eyeBlink: string;
  eyeSquint: string;
  mouthBig: string;
  mouthO: string;
  mouthSmile: string;
  mouthE: string;
  mouthFlat: string;
}

// Extend Window for Web Speech API & Install Prompt & Process Polyfill
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
    process: any;
  }
  
  interface WindowEventMap {
    "beforeinstallprompt": any;
  }
}

// Declare process for Safe Access checks
declare var process: {
  env: {
    [key: string]: string | undefined;
  }
};
