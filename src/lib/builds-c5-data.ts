export type C5PhaseTemplate = {
  title: string;
  items: { name: string; brand: string; price: number | null }[];
};

export const C5_PHASES: C5PhaseTemplate[] = [
  {
    title: 'Interior & Electronics',
    items: [
      { name: 'Steering Wheel', brand: 'Lowered Empire — Black Reaper Carbon Fiber', price: 220 },
      { name: 'Wheel Hub', brand: 'NRG SRK-170H', price: 103 },
      { name: 'Wheel Quick Release', brand: 'NRG SRK-200BK', price: 103 },
      { name: 'SRS Resistor / Warning Light Bypass', brand: 'NRG-SRK-RES', price: 14 },
      { name: 'Digital Media Receiver', brand: 'Pioneer DMH-W3050NEX', price: 430 },
      { name: 'Double DIN Dash Bezel', brand: 'ECOTRIC', price: 49 },
      { name: 'Amplifier Interface Harness', brand: 'Axxess XSVI-2004', price: 130 },
      { name: 'Antenna Adapter', brand: 'Metra 40-GM10', price: 7 },
      { name: 'Radio Wiring Harness', brand: 'Metra 70-1858', price: 7 },
      { name: 'Backup Camera', brand: 'Pioneer ND-BC011', price: 97 },
      { name: 'Floor Mats', brand: 'Lloyd Mats All-Weather Rubber', price: 260 },
    ],
  },
  {
    title: 'Suspension',
    items: [
      { name: 'Coilovers', brand: 'BC Racing BR Series', price: 1200 },
      { name: 'Adjustable Control Arms', brand: 'TBD', price: null },
      { name: 'Sway Bars + Poly Bushings', brand: 'TBD', price: null },
    ],
  },
  {
    title: 'Window Tint',
    items: [
      { name: 'Ceramic Tint', brand: 'Professional Install', price: 500 },
    ],
  },
  {
    title: 'Seats',
    items: [
      { name: 'Bucket Seats', brand: 'Corbeau A4 Leather', price: 1300 },
    ],
  },
  {
    title: 'Front End Swap',
    items: [
      { name: 'Front Bumper — Kyouki Style', brand: 'KBD Body Kits Polyurethane', price: 600 },
      { name: 'Headlights — Sleepy Eye Triple Square Kit', brand: 'Low-Rise', price: 560 },
    ],
  },
  {
    title: 'Wrap',
    items: [
      { name: 'Midnight Purple Full Wrap', brand: 'Professional Install', price: 2500 },
    ],
  },
  {
    title: 'Taillights',
    items: [
      { name: 'LED Taillights', brand: 'INFIRAI LED', price: 500 },
    ],
  },
  {
    title: 'Intake',
    items: [
      { name: 'Cold Air Intake', brand: 'Airaid SynthaMax MXP Series', price: 370 },
    ],
  },
  {
    title: 'Exhaust + Cooling + Drivetrain',
    items: [
      { name: 'Axle-Back Exhaust', brand: 'Corsa Sport Tigershark Black PVD', price: 2214 },
      { name: 'Radiator w/ Integrated Trans Cooler', brand: 'DeWitts', price: 891 },
      { name: 'Stall Converter + Shift Kit', brand: 'TBD', price: null },
    ],
  },
  {
    title: 'ECU Tune',
    items: [
      { name: 'Handheld Tuner', brand: 'HP MPIV4', price: 400 },
      { name: 'Universal Tune Credits x2', brand: 'HP Tuners (post-exhaust + post-blower)', price: 100 },
    ],
  },
  {
    title: 'Front Splitter',
    items: [
      { name: 'Front Splitter', brand: 'TBD', price: null },
    ],
  },
  {
    title: 'Side Skirts',
    items: [
      { name: 'Side Skirts', brand: 'TBD', price: null },
    ],
  },
  {
    title: 'Rear Diffuser',
    items: [
      { name: 'Rear Diffuser', brand: 'TBD', price: null },
    ],
  },
  {
    title: 'Rear Wing',
    items: [
      { name: 'APR GTC-300 67" Wing', brand: 'APR Performance', price: 2300 },
    ],
  },
  {
    title: 'Supercharger',
    items: [
      { name: 'TVS2300 Supercharger Kit', brand: 'Magnuson', price: 4300 },
    ],
  },
];
