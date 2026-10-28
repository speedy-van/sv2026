export interface CouncilMovingResource {
  councilArea: string;
  label: string;
  href: string;
  purpose: string;
  scopeNote: string;
  verificationLevel: 'content' | 'navigation-only' | 'scriptedCMS';
  primarySourceURLs: readonly string[];
}

// Official resources researched on 15 October 2026; no permit eligibility is inferred.
export const councilMovingResources = [
  {
    councilArea: 'Glasgow City',
    label: 'Glasgow City Council — roads and parking',
    href: 'https://www.glasgow.gov.uk/roads',
    purpose: 'Council roads and parking information and service navigation.',
    scopeNote:
      'Glasgow City council area. Use the council service to check parking and loading arrangements at your exact address.',
    verificationLevel: 'navigation-only',
    primarySourceURLs: ['https://my.glasgow.gov.uk/en', 'https://www.glasgow.gov.uk/roads'],
  },
  {
    councilArea: 'Renfrewshire',
    label: 'Renfrewshire Council — parking dispensation',
    href: 'https://www1.renfrewshire.gov.uk/article/10454/Parking-dispensation',
    purpose:
      "Explain the council's parking-dispensation process and how to ask about extended loading needs.",
    scopeNote:
      "Renfrewshire council area, subject to the council's assessment of the exact vehicle, activity and location.",
    verificationLevel: 'content',
    primarySourceURLs: ['https://www1.renfrewshire.gov.uk/article/10454/Parking-dispensation'],
  },
  {
    councilArea: 'Inverclyde',
    label: 'Inverclyde Council — about parking',
    href: 'https://www.inverclyde.gov.uk/environment/roads-lighting/parking-inverclyde/parking-inverclyde/about-parking',
    purpose: "Find the council's parking information, town-specific restrictions and linked guidance.",
    scopeNote: 'Inverclyde council area. Town and street restrictions must be checked individually.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.inverclyde.gov.uk/environment/roads-lighting/parking-inverclyde/parking-inverclyde/about-parking',
    ],
  },
  {
    councilArea: 'West Dunbartonshire',
    label: 'West Dunbartonshire Council — parking and car parks',
    href: 'https://www.west-dunbarton.gov.uk/roads-parking-travel/parking-and-car-parks',
    purpose: 'Find council parking, car-park and enforcement resources.',
    scopeNote:
      'West Dunbartonshire council area. Private car parks and customer premises require their own permission checks.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.west-dunbarton.gov.uk/roads-parking-travel/parking-and-car-parks',
      'https://www.west-dunbarton.gov.uk/roads-parking-travel/parking-and-car-parks/parking',
    ],
  },
  {
    councilArea: 'East Dunbartonshire',
    label: 'East Dunbartonshire Council — Traffic Regulation Orders',
    href: 'https://www.eastdunbarton.gov.uk/services/a-z-of-services/roads-pavements-transport/traffic-regulation-orders/',
    purpose: 'Find council traffic-order notices affecting parking, loading and road access.',
    scopeNote:
      "East Dunbartonshire council area. An order's named roads, status and effective date determine its scope; proposals are not necessarily current restrictions.",
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.eastdunbarton.gov.uk/services/a-z-of-services/roads-pavements-transport/traffic-regulation-orders/',
    ],
  },
  {
    councilArea: 'East Renfrewshire',
    label: 'East Renfrewshire Council — pavement parking information',
    href: 'https://eastrenfrewshire.gov.uk/pavement-parking-ban',
    purpose: 'Council information about pavement-parking restrictions and associated local assessments.',
    scopeNote:
      'East Renfrewshire council area. Check current council information and the signs at your exact address.',
    verificationLevel: 'navigation-only',
    primarySourceURLs: [
      'https://getinvolved.eastrenfrewshire.gov.uk/neighbourhood-streets-2024',
      'https://eastrenfrewshire.gov.uk/pavement-parking-ban',
    ],
  },
  {
    councilArea: 'South Lanarkshire',
    label: 'South Lanarkshire Council — parking and loading safely',
    href: 'https://www.southlanarkshire.gov.uk/parking-car-parks/avoid-getting-parking-ticket',
    purpose: 'Council guidance on reading parking restrictions and planning lawful loading.',
    scopeNote:
      'South Lanarkshire council area, with actual street signs and restrictions controlling each location.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.southlanarkshire.gov.uk/parking-car-parks/avoid-getting-parking-ticket',
      'https://www.southlanarkshire.gov.uk/parking-car-parks/traffic-regulation-orders',
    ],
  },
  {
    councilArea: 'North Lanarkshire',
    label: 'North Lanarkshire Council — parking enforcement',
    href: 'https://www.northlanarkshire.gov.uk/roads-parking-and-active-travel/parking/parking-enforcement',
    purpose: 'Council explanations of parking and loading restrictions and the relevant signs.',
    scopeNote: 'North Lanarkshire council area. Restrictions are location- and time-specific.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.northlanarkshire.gov.uk/roads-parking-and-active-travel/parking/parking-enforcement',
    ],
  },
  {
    councilArea: 'City of Edinburgh',
    label: 'City of Edinburgh Council — parking dispensations and suspensions',
    href: 'https://www.edinburgh.gov.uk/parking-spaces/dispensations-suspensions',
    purpose:
      "Find the council's separate dispensation and parking-bay suspension processes for loading or moving needs.",
    scopeNote:
      'City of Edinburgh council area. The exact location, proposed activity and type of parking space determine the appropriate process.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.edinburgh.gov.uk/parking-spaces/dispensations-suspensions'],
  },
  {
    councilArea: 'East Lothian',
    label: 'East Lothian Council — parking enforcement',
    href: 'https://www.eastlothian.gov.uk/roads-parking-and-transport/parking/parking-enforcement',
    purpose: 'Find council guidance on parking, loading restrictions and street signs.',
    scopeNote:
      'East Lothian council area. A town-centre restriction is not a rule for every residential or rural address.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.eastlothian.gov.uk/roads-parking-and-transport/parking/parking-enforcement',
    ],
  },
  {
    councilArea: 'Midlothian',
    label: 'Midlothian Council — parking restrictions',
    href: 'https://www.midlothian.gov.uk/info/200294/parking/455/parking_restrictions',
    purpose: 'Find council parking and loading restrictions and the linked restriction map.',
    scopeNote:
      'Midlothian council area. The exact street, signs and applicable conditions must be checked for each address.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.midlothian.gov.uk/info/200294/parking/455/parking_restrictions'],
  },
  {
    councilArea: 'West Lothian',
    label: 'West Lothian Council — parking',
    href: 'https://www.westlothian.gov.uk/parking',
    purpose: 'Find parking, car-park and access-obstruction information from the council.',
    scopeNote:
      'West Lothian council area. Follow the relevant town or street resource rather than assuming a council-wide parking limit.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.westlothian.gov.uk/parking'],
  },
  {
    councilArea: 'Stirling',
    label: 'Stirling Council — traffic restrictions',
    href: 'https://www.stirling.gov.uk/roads-transport-and-parking/roads-and-pavements/apply-for-traffic-restrictions/',
    purpose:
      'Find how to ask the council about temporary traffic restrictions, including parking suspensions.',
    scopeNote:
      'Roads managed by Stirling Council. Trunk roads and motorways are outside the council process described on this page.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.stirling.gov.uk/roads-transport-and-parking/roads-and-pavements/apply-for-traffic-restrictions/',
    ],
  },
  {
    councilArea: 'Falkirk',
    label: 'Falkirk Council — parking enforcement, dispensations and suspensions',
    href: 'https://www.falkirk.gov.uk/streets-and-parking/parking-tickets-and-enforcement',
    purpose: 'Find parking/loading guidance and council information about dispensations and suspensions.',
    scopeNote:
      'Falkirk council area, subject to exact location and council approval for any requested restriction change.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.falkirk.gov.uk/streets-and-parking/parking-tickets-and-enforcement'],
  },
  {
    councilArea: 'Clackmannanshire',
    label: 'Clackmannanshire Council — parking',
    href: 'https://www.clacks.gov.uk/transport/parking/',
    purpose: 'Find parking information and explanations of restricted parking zones and access.',
    scopeNote: 'Clackmannanshire council area. Named restricted-zone details are not council-wide rules.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.clacks.gov.uk/transport/parking/'],
  },
  {
    councilArea: 'Fife',
    label: 'Fife Council — parking dispensations and suspensions',
    href: 'https://www.fife.gov.uk/roads-travel-parking/parking-and-car-parks/parking-dispensations-and-parking-suspensions',
    purpose:
      'Find how the council distinguishes parking dispensations from parking-bay suspensions and how to enquire about removal loading.',
    scopeNote:
      'Fife council area. Eligibility and conditions depend on the exact activity, location and space requested.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.fife.gov.uk/roads-travel-parking/parking-and-car-parks/parking-dispensations-and-parking-suspensions',
    ],
  },
  {
    councilArea: 'Dundee City',
    label: 'Dundee City Council — parking dispensation',
    href: 'https://www.dundeecity.gov.uk/parking-information/parking-dispensation',
    purpose:
      "Find the council's permission process and conditions for extended parking in a restricted location.",
    scopeNote:
      'Dundee City council area. A dispensation does not establish permission for otherwise excluded locations or activities.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.dundeecity.gov.uk/parking-information/parking-dispensation'],
  },
  {
    councilArea: 'Perth and Kinross',
    label: 'Perth and Kinross Council — parking',
    href: 'https://www.pkc.gov.uk/article/14738/Parking',
    purpose: 'Find council parking resources for your collection or delivery location.',
    scopeNote:
      'Perth and Kinross council area. Check the resource for your town; Perth city-centre access arrangements do not apply to every location.',
    verificationLevel: 'navigation-only',
    primarySourceURLs: [
      'https://www.pkc.gov.uk/article/22131/Bay-suspensions-and-dispensations',
      'https://www.pkc.gov.uk/article/14738/Parking',
    ],
  },
  {
    councilArea: 'Angus',
    label: 'Angus Council — street parking dispensation',
    href: 'https://www.angus.gov.uk/roads_parking_and_travel/parking/permission_to_park_on_the_street_parking_dispensation',
    purpose:
      'Find permission guidance for extended street loading and the separate process for using council car-park spaces.',
    scopeNote:
      'Angus council area. Street dispensations and off-street car-park suspensions are different arrangements.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.angus.gov.uk/roads_parking_and_travel/parking/permission_to_park_on_the_street_parking_dispensation',
      'https://www.angus.gov.uk/roads_parking_and_travel/parking/permission_to_use_car_park_spaces_parking_suspension',
    ],
  },
  {
    councilArea: 'Aberdeen City',
    label: 'Aberdeen City Council — parking and removal vans',
    href: 'https://www.aberdeencity.gov.uk/Council-Services/roads-parking-and-travel/parking',
    purpose: 'Find council parking information, including guidance for removal vans and loading activity.',
    scopeNote:
      'Aberdeen City council area. Check the actual location and any applicable loading restrictions; this is not an unrestricted-parking permission.',
    verificationLevel: 'scriptedCMS',
    primarySourceURLs: [
      'https://www.aberdeencity.gov.uk/Council-Services/roads-parking-and-travel/parking',
      'https://sites.aberdeencity.gov.uk/Council-Services/roads-parking-and-travel/parking',
      'https://sites.aberdeencity.gov.uk/Council-Services/roads-parking-and-travel/roadworks-permits/order-traffic-cones-for-temporary-use',
    ],
  },
  {
    councilArea: 'Aberdeenshire',
    label: 'Aberdeenshire Council — traffic measures',
    href: 'https://aberdeenshire.gov.uk/roads-and-travel/roads/traffic-management/traffic-measures/',
    purpose:
      'Find official traffic-management information and routes to relevant waiting, loading and access restrictions.',
    scopeNote:
      'Aberdeenshire council-managed roads. The page distinguishes council responsibilities from Scottish Government responsibility for trunk roads.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://aberdeenshire.gov.uk/roads-and-travel/roads/traffic-management/traffic-measures/',
    ],
  },
  {
    councilArea: 'Moray',
    label: 'Moray Council — parking and car parks',
    href: 'https://www.moray.gov.uk/roads-and-transport/parking-and-car-parks/',
    purpose: 'Find council car-park information and the relevant contacts for parking enquiries.',
    scopeNote:
      'Council-managed car parks across Moray. Do not apply car-park permissions to on-street loading or private premises.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.moray.gov.uk/roads-and-transport/parking-and-car-parks/'],
  },
  {
    councilArea: 'Highland',
    label: 'Highland Council — parking and permits',
    href: 'https://www.highland.gov.uk/parking',
    purpose:
      'Find current council parking, restricted-area permission and parking-bay reservation resources.',
    scopeNote:
      'Highland council area. Follow the current resource for the actual place and proposed activity; do not infer a ferry crossing solely because a place is on an island.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.highland.gov.uk/parking',
      'https://www.highland.gov.uk/parking-permits/permission-park-restricted-area',
    ],
  },
  {
    councilArea: 'Argyll and Bute',
    label: 'Argyll and Bute Council — car parks and parking',
    href: 'https://www.argyll-bute.gov.uk/roads-and-travel/car-parks-and-parking',
    purpose: 'Find locality-specific council car-park information, parking enquiries and restrictions.',
    scopeNote:
      'Argyll and Bute council area, with separate locality resources for Mid Argyll/Kintyre/Islay, Oban/Lorn/Isles, Helensburgh/Lomond and Bute/Cowal. Do not generalise a locality-specific rule across the whole council area.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.argyll-bute.gov.uk/roads-and-travel/car-parks-and-parking'],
  },
  {
    councilArea: 'South Ayrshire',
    label: 'Ayrshire Roads Alliance — South Ayrshire parking information',
    href: 'https://www.ayrshireroadsalliance.org/Parking-Information/Parking-Information.aspx',
    purpose: 'Find parking and access resources provided by the official shared council roads service.',
    scopeNote:
      'South Ayrshire. The linked Loading and Access Permit resource is limited to named Ayr town-centre streets and eligibility groups, not every South Ayrshire place or removal van.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.ayrshireroadsalliance.org/Parking-Information/Parking-Information.aspx',
      'https://www.ayrshireroadsalliance.org/Parking-Information/Business-Parking-Permits/Loading-and-Access-Permit.aspx',
      'https://www.east-ayrshire.gov.uk/TransportAndStreets/TransportAndStreets.aspx',
    ],
  },
  {
    councilArea: 'East Ayrshire',
    label: 'Ayrshire Roads Alliance — East Ayrshire parking information',
    href: 'https://www.ayrshireroadsalliance.org/Parking-Information/Parking-Information.aspx',
    purpose: 'Find parking and road-access resources provided by the official shared council roads service.',
    scopeNote:
      'East Ayrshire. The same service also covers South Ayrshire, but its Ayr-specific loading/access permit must not be described as an East Ayrshire permit.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.ayrshireroadsalliance.org/Parking-Information/Parking-Information.aspx',
      'https://www.east-ayrshire.gov.uk/TransportAndStreets/TransportAndStreets.aspx',
    ],
  },
  {
    councilArea: 'North Ayrshire',
    label: 'North Ayrshire Council — parking rules',
    href: 'https://www.north-ayrshire.gov.uk/roads-and-parking/parking/parking-rules',
    purpose: 'Find council parking guidance and links to current local parking information.',
    scopeNote:
      "North Ayrshire council area. Use this council's own resources rather than East/South Ayrshire Roads Alliance procedures.",
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.north-ayrshire.gov.uk/roads-and-parking/parking/parking-rules',
      'https://www.north-ayrshire.gov.uk/roads-and-parking/parking',
    ],
  },
  {
    councilArea: 'Dumfries and Galloway',
    label: 'Dumfries and Galloway Council — parking',
    href: 'https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/parking',
    purpose: 'Find council parking, car-park and local permit information.',
    scopeNote:
      "Dumfries and Galloway council area. The hub's resident/visitor permit resources name particular towns and zones; do not apply those schemes to all places in the council area.",
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/parking'],
  },
  {
    councilArea: 'Scottish Borders',
    label: 'Scottish Borders Council — parking restrictions',
    href: 'https://www.scotborders.gov.uk/roads-pavements/traffic-management-calming/5',
    purpose: 'Find council explanations of parking restrictions and town-specific Traffic Regulation Orders.',
    scopeNote:
      "Scottish Borders council area. Each town's relevant traffic order and street signs define local restrictions.",
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.scotborders.gov.uk/roads-pavements/traffic-management-calming/5'],
  },
  {
    councilArea: 'Na h-Eileanan Siar',
    label: 'Comhairle nan Eilean Siar — Traffic Regulation Orders',
    href: 'https://www.cne-siar.gov.uk/roads-and-travel/traffic-regulation-orders-tro',
    purpose: 'Find current council traffic orders and distinguish orders in force from proposals.',
    scopeNote:
      'Na h-Eileanan Siar council area. Read the actual order for its named roads and status; island location alone does not prove every local journey includes a ferry.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.cne-siar.gov.uk/roads-and-travel/traffic-regulation-orders-tro',
      'https://www.cne-siar.gov.uk/roads-and-travel',
    ],
  },
  {
    councilArea: 'Orkney Islands',
    label: 'Orkney Islands Council — car parks',
    href: 'https://www.orkney.gov.uk/travel-roads-and-parking/parking/car-parks',
    purpose: 'Find council car-park locations, conditions and related parking information.',
    scopeNote:
      'Council-managed car parks in Orkney, including named Kirkwall and Stromness locations. Car-park information is not an on-street loading permission.',
    verificationLevel: 'content',
    primarySourceURLs: ['https://www.orkney.gov.uk/travel-roads-and-parking/parking/car-parks'],
  },
  {
    councilArea: 'Shetland Islands',
    label: 'Shetland Islands Council — road closures and roadworks',
    href: 'https://www.shetland.gov.uk/roads-footpaths/road-closures-weekly-road-works-report',
    purpose:
      'Check council notices of current roadworks and road closures when planning collection or delivery access.',
    scopeNote:
      'Shetland council roads covered by the current report. Read dates and named roads for each notice; a roadworks notice is not a general parking permit.',
    verificationLevel: 'content',
    primarySourceURLs: [
      'https://www.shetland.gov.uk/roads-footpaths/road-closures-weekly-road-works-report',
      'https://www.shetland.gov.uk/roads',
    ],
  },
] as const satisfies readonly CouncilMovingResource[];

const resourcesByCouncil = new Map<string, CouncilMovingResource>(
  councilMovingResources.map((resource) => [resource.councilArea, resource]),
);

export function getCouncilMovingResource(councilArea: string): CouncilMovingResource | undefined {
  return resourcesByCouncil.get(councilArea);
}
