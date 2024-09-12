import {strict} from 'assert';
import {OpenAI} from 'openai';
import {
  Condition,
  evalVariablesInToken,
  GenericCondition,
  getLocationsOfVariablesInConditions,
  LocationsOfVariablesInConditions,
  ProductionNode,
  Rete,
  Token
} from 'rete-next/index';
import {ParseError, parseRete, ParseSuccess} from 'rete-next/productions0';
import {build, parse} from 'dfa/compile.js';

type StateMachine = {
  stateTable: number[][];
  accepting: number[];
  tags: string[];
};

function compile(s: string, externalSymbols: any = {}): StateMachine {
  return build(parse(s, externalSymbols));
}

const openai = new OpenAI();

async function getOpenAiResponse(system: string, user: string) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{
      role: 'system',
      content: system,
    }, {
      role: 'user',
      content: user
    }]
  });
  return response.choices[0].message;
}

let gensymN = 0;

function gensym() {
  return `gensym${gensymN++}`;
}

type ProductionData = { production: ProductionNode, locations: LocationsOfVariablesInConditions, logic: ProductionLogic };
type ProductionDataArray = ProductionData[];

type ProductionLogic = (rete: Rete, tokens:[Token[], Token[]], production: ProductionNode, locations: LocationsOfVariablesInConditions) => Promise<void>;

type KnowledgeSource = {
  productionsText: string;
  productionLogics: ProductionLogic[];
};

type RegisteredKnowledgeSource = {
  knowledgeSource: KnowledgeSource;
  productions: ProductionDataArray;
};

const knowledgeSource1: KnowledgeSource = {
  productionsText: `
((<x> species <s>) -{(species <s> -)} -> "ks1 gather species")
((species <s> -) -> "ks1 determine food chain")
`,
  productionLogics: [
    async (rete, tokens, production, locations) => {
      const tokensEligibleToBeAdded = tokens[0];
      let token = tokensEligibleToBeAdded[0];
      let willFire = production.willFireTokenAdded(token);
      if (willFire) {
        let evalVariables = evalVariablesInToken(['s'], locations, token);
        let species = evalVariables['s'];
        if (species !== null) {
          rete.add('species', species, '-');
          console.log('Added species:', species);
        }
      } else {
        console.log('Production was fired but the token is no longer available:', token.toString());
      }
    },
    async (rete, tokens, production, locations) => {
      let [ks1TokensToAdd4, ks1TokensToRemove4] = production.willFire();
      console.log(ks1TokensToAdd4.map(t => t.toString()).join(' '));

      const speciesList = [];
      for (const token of ks1TokensToAdd4) {
        let species = token.index(0).get_field(1);
        console.log(species);
        speciesList.push(species);
      }
      let userQuestion = speciesList.join(',');
      console.log('Retrieving food chain for:', userQuestion);

      let message = await getOpenAiResponse(
        `Given a list of species, respond with lines of knowledge triples in the
    form of 'species,eats,species' on each line. Exclude triples that use species
    not provided in the list. Avoid stopwords and any other text than the list of triples.`,
        userQuestion
      );

      if(message.refusal) {
        console.log('OpenAI refused with message:', message.refusal);
      }

      if (message.content) {
        const triplesEntries = message.content.split('\n');
        for (const triplesEntry of triplesEntries) {
          let s = triplesEntry.trim();
          if (s.length === 0) continue;
          const [id, attr, val] = s.split(',');
          rete.add(id, attr, val);
          console.log('Added:', id, attr, val);
        }
      }
    }
  ],
};

const knowledgeSource2: KnowledgeSource = {
  productionsText: `
((species <s> -) -> "ks2 determine average weight")
  `,
  productionLogics:[
    async (rete, tokens, production, locations) => {
      const tokensEligibleToBeAdded = tokens[0];
      let token = tokensEligibleToBeAdded[0];
      let willFire = production.willFireTokenAdded(token);
      if (willFire) {
        let evalVariables = evalVariablesInToken(['s'], locations, token);
        let species = evalVariables['s'];
        if (species !== null) {
          console.log('Retrieving average weight for:', species);

          let message = await getOpenAiResponse(
            `Given a species, respond with the average weight of an individual of the species in kilograms. 
            Respond with just a number, without other words or punctuation.`,
            species
          );
          if (message.refusal) {
            console.log('OpenAI refused with message:', message.refusal);
          }

          if (message.content) {
            if(Number.isNaN(parseFloat(message.content))) {
              console.log('Unparsable number', message.content);
            } else {
              rete.add(species, 'weight', message.content);
              console.log('Added:', species, 'weight', message.content);
            }
          }

        }
      } else {
        console.log('Production was fired but the token is no longer available:', token.toString());
      }
    },
  ],
};

const knowledgeSource3: KnowledgeSource = {
  productionsText: `
((animal <a> -) -{(<t> includes <a>)} -> "start trip")
(
 (trip <t> -) 
 (<wt> <- #sum(<w>)) from {(<t> includes <aa>) (<aa> species <ss>) (<ss> weight <w>)}
 (animal <b> -) 
 -{(trip <t2> -) (<t2> includes <b>)} 
 (<b> species <s2>) 
 -{(<t> includes <aa>) (<aa> species <ss>) (<s2> eats <ss>)} 
 -{(<t> includes <aa>) (<aa> species <ss>) (<ss> eats <s2>)} 
 (<s2> weight <w2>)
 ((<w2> + <wt>) < 100)
 -> "add compatible animal to trip"
)
    `,
  productionLogics: [
    async (rete, tokens, production, locations) => {
      const tokensEligibleToBeAdded = tokens[0];
      let token = tokensEligibleToBeAdded[0];
      let willFire = production.willFireTokenAdded(token);
      if (willFire) {
        let evalVariables = evalVariablesInToken(['a'], locations, token);
        let animal = evalVariables['a'];
        if (animal !== null) {
          const trip = gensym();
          rete.add('trip', trip, '-');
          rete.add(trip, 'includes', animal);
          console.log('Added trip', trip, 'with', animal);
        }
      } else {
        console.log('Production was fired but the token is no longer available:', token.toString());
      }
    },
    async (rete, tokens, production, locations) => {
      const tokensEligibleToBeAdded = tokens[0];
      let token = tokensEligibleToBeAdded[0];
      let willFire = production.willFireTokenAdded(token);
      if (willFire) {
        let evalVariables = evalVariablesInToken(['t', 'b'], locations, token);
        const trip = evalVariables['t'];
        const animal = evalVariables['b'];
        if (animal !== null && trip !== null) {
          rete.add(trip, 'includes', animal);
          console.log('To trip', trip, 'we added', animal);
        }
      } else {
        console.log('Production was fired but the token is no longer available:', token.toString());
      }
    },
  ],
};

function getVariables(lhs: GenericCondition[]): string[] {
  let set = new Set<string>();
  for (const cond of lhs) {
    if(cond instanceof Condition) {
      set = new Set([...set, ...cond.variables()]);
    }
  }
  return Array.from(set);
}

function registerKnowledgeSourceProductions(rete: Rete, productionsText: string, productionLogics: ProductionLogic[]): ProductionDataArray {
  const input = productionsText;
  const reteParse: ParseError | ParseSuccess = parseRete(input);
  if((reteParse as ParseError).error) {
    console.log((reteParse as ParseError).error);
    throw new Error('Could not parse productions');
  } else {
    console.log('Parsed productions');
  }
  const parsed = reteParse as ParseSuccess;

  const productions: ProductionDataArray = [];
  let logicIndex = 0;
  for (const {lhs, rhs} of parsed.specs) {
    let p = rete.addProduction(lhs, rhs);
    let variables = getVariables(lhs);
    let locationsOfVariablesInConditions = getLocationsOfVariablesInConditions(variables, lhs);
    productions.push({ production: p, locations: locationsOfVariablesInConditions, logic: productionLogics[logicIndex++]});
    console.log('Added production:', rhs);
  }

  return productions;
}
function registerKnowledgeSource(rete: Rete, knowledgeSource: KnowledgeSource): RegisteredKnowledgeSource {
  let productions = registerKnowledgeSourceProductions(rete, knowledgeSource.productionsText, knowledgeSource.productionLogics);
  return {
    knowledgeSource,
    productions
  };
}

function explainStateMachine(stateMachine: StateMachine, allProductions: ProductionData[]) {
  console.log('StateMachine with available productions:', allProductions.map((p, i) => `p${i}:"${p.production.rhs}"`).join(','));
  const stateTable = stateMachine.stateTable;
  for (let i = 1; i < stateTable.length; i++) {
    console.log(`State s${i}`, stateMachine.accepting[i] ? '(Accepting)' : '');
    let transitions = stateTable[i];
    for (let t = 0; t < allProductions.length; t++) {
      if(transitions[t] === i) {
        console.log(` Transition to self with p${t}`);
      }
    }
    for (let t = 0; t < allProductions.length; t++) {
      if(transitions[t] !== i && transitions[t] != 0) {
        console.log(` Transition to s${transitions[t]} with p${t}`);
      }
    }
  }
  console.log('End');
}

async function fireProduction(productionDatum: ProductionData, rete: Rete, tokensToAddOrRemove: [Token[], Token[]]) {
  await productionDatum.logic
    .call(null, rete, tokensToAddOrRemove, productionDatum.production, productionDatum.locations);
}

type ConflictItem = {
  symbol: number,
  productionDatum: ProductionData,
  tokensToAddOrRemove: [Token[], Token[]],
  isSelfTransition: boolean,
}

interface Resolver {
  resolveConflicts(conflictSet: ConflictItem[]): ConflictItem;
}

class TrivialResolver implements Resolver {
  resolveConflicts(conflictSet: ConflictItem[]) {
    return conflictSet[0]; //Trivial resolver for now
  }
}

class SelfTransitionResolver extends TrivialResolver {
  resolveConflicts(conflictSet: ConflictItem[]): ConflictItem {
    const selfTransition = conflictSet.find(c => c.isSelfTransition);
    if (selfTransition) {
      return selfTransition;
    }
    return super.resolveConflicts(conflictSet);
  }
}

class OverridingSelfTransitionResolver extends SelfTransitionResolver {
  constructor(private overridingTransitions: number[]) {
   super();
  }
  resolveConflicts(conflictSet: ConflictItem[]): ConflictItem {
    for (const overridingTransition of this.overridingTransitions) {
      const found = conflictSet.find(c => c.symbol === overridingTransition);
      if(found) {
        return found;
      }
    }
    return super.resolveConflicts(conflictSet);
  }
}

class RegexScheduler {
  stateMachine: StateMachine;
  currentState = 1;

  constructor(private schedulerRegex: string, private allProductions: ProductionData[]) {
    this.stateMachine = compile(schedulerRegex);
    strict.strict(this.stateMachine.stateTable[0].length === allProductions.length, 'Statemachine should have as many symbols as there are total productions');
    explainStateMachine(this.stateMachine, allProductions);
  }

  conflictSet(): ConflictItem[] {
    let transitions = this.stateMachine.stateTable[this.currentState];
    const transitionsExist = transitions.find(s => s !== 0);
    if(!transitionsExist) {
      console.log('No transitions exist');
      return [];
    }
    const ret: ConflictItem[] = [];

    for (let t = 0; t < this.allProductions.length; t++) {
      if(transitions[t] != 0) {
        let productionDatum = this.allProductions[t];
        let canFire = productionDatum.production.canFire();
        if(canFire[0].length) {
          ret.push(
            {
              symbol: t,
              productionDatum: productionDatum,
              tokensToAddOrRemove: canFire,
              isSelfTransition: transitions[t] === this.currentState,
            }
          );
        }
      }
    }
    if (ret.length) {
      console.log(`Transitions can fire: ${ret.map(c => `"${c.productionDatum.production.rhs}"`)}`);
    } else {
      console.log('No allowed transitions can fire');
    }
    return ret;
  }

  takeTransition(symbol: number) {
    let transitions = this.stateMachine.stateTable[this.currentState];
    this.currentState = transitions[symbol];
    console.log(`Transitioned to state ${this.currentState}`);
  }

  onAcceptingState() {
    return this.stateMachine.accepting[this.currentState];
  }
}

async function runBlackboard(scheduler: RegexScheduler, resolver: Resolver, rete: Rete) {
  do {
    let conflictSet = scheduler.conflictSet();
    if (!conflictSet.length) {
      if (scheduler.onAcceptingState()) {
        console.log('No further transitions, reached accepting state');
      } else {
        console.log('No further transitions, failure to reach accepting state');
      }
      break;
    }
    let conflictItem = resolver.resolveConflicts(conflictSet);
    console.log(`Production "${conflictItem.productionDatum.production.rhs}" can add:`, conflictItem.tokensToAddOrRemove[0].length);
    await fireProduction(conflictItem.productionDatum, rete, conflictItem.tokensToAddOrRemove);

    scheduler.takeTransition(conflictItem.symbol);
  } while (true);
  console.log(rete.working_memory.map(w => w.toString()).join(' '));
}

async function main() {
  // ## Creating Rete and OpenAI integration
  const rete = new Rete();
  console.log('Created Rete and OpenAI integration');

  // ## Registering Knowledge Sources and constructing the set of all productions
  let ks1 = registerKnowledgeSource(rete, knowledgeSource1);
  let ks2 = registerKnowledgeSource(rete, knowledgeSource2);
  let ks3 = registerKnowledgeSource(rete, knowledgeSource3);

  const knowledgeSources = [ks1, ks2, ks3];
  let allProductions: ProductionData[] = [];
  for (const knowledgeSource of knowledgeSources) {
    allProductions = [...allProductions, ...knowledgeSource.productions];
  }

  // ## Constructing the statemachine of allowed sequence of productions
  const schedulerRegex = `# define symbols
a1   = 0; # First production of KS 1
a2   = 1; # Second production of KS 1
a3   = 2; # First production of KS 2
a4   = 3; # First production of KS 3
a5   = 4; # Second production of KS 3

# define main state machine pattern
main = a1+ a2 a3+ (a4 a5*)+;
`;
  const scheduler = new RegexScheduler(schedulerRegex, allProductions);
  let resolver = new OverridingSelfTransitionResolver([4]);

  // ## Add initial data
  rete.add('animal', 'a1', '-');
  rete.add('a1', 'species', 'rabbit');
  rete.add('a1', 'gender', 'male');
  rete.add('animal', 'a2', '-');
  rete.add('a2', 'species', 'rabbit');
  rete.add('a2', 'gender', 'female');
  rete.add('animal', 'a3', '-');
  rete.add('a3', 'species', 'wolf');
  rete.add('a3', 'gender', 'female');
  rete.add('animal', 'a4', '-');
  rete.add('a4', 'species', 'snake');
  rete.add('a4', 'gender', 'male');

  // ## Run Blackboard
  await runBlackboard(scheduler, resolver, rete);
}

main();
