import prompts, { Answers, Choice, PromptObject } from "prompts"
import { Firestore } from "firebase/firestore"
import { fromQueryToFirebaseDocumentInfo, getAllCollectionDocs, commonTerms, extractPrefix } from "@zkmpc/actions/src"
import { CeremonyInputData, FirebaseDocumentInfo, CircomCompilerData, CircuitInputData } from "@zkmpc/actions/src/types"
import { CeremonyTimeoutType } from "@zkmpc/actions/src/types/enums"
import theme from "./theme"
import { COMMAND_ERRORS, GENERIC_ERRORS, showError } from "./errors"

/**
 * Ask a binary (yes/no or true/false) customizable question.
 * @param question <string> - the question to be answered.
 * @param active <string> - the active option (default yes).
 * @param inactive <string> - the inactive option (default no).
 * @returns <Promise<Answers<string>>>
 */
export const askForConfirmation = async (question: string, active = "yes", inactive = "no"): Promise<Answers<string>> =>
    prompts({
        type: "toggle",
        name: "confirmation",
        message: theme.text.bold(question),
        initial: false,
        active,
        inactive
    })

/**
 * Prompt a series of questios to gather input data for the ceremony setup.
 * @param firestore <Firestore> - the instance of the Firestore database.
 * @returns <Promise<CeremonyInputData>> - the necessary information for the ceremony provided by the coordinator.
 */
export const promptCeremonyInputData = async (firestore: Firestore): Promise<CeremonyInputData> => {
    // Get ceremonies prefixes already in use.
    const ceremoniesDocs = await fromQueryToFirebaseDocumentInfo(
        await getAllCollectionDocs(firestore, commonTerms.collections.ceremonies.name)
    ).sort((a: FirebaseDocumentInfo, b: FirebaseDocumentInfo) => a.data.sequencePosition - b.data.sequencePosition)

    const prefixesAlreadyInUse =
        ceremoniesDocs.length > 0 ? ceremoniesDocs.map((ceremony: FirebaseDocumentInfo) => ceremony.data.prefix) : []

    // Define questions.
    const questions: Array<PromptObject> = [
        {
            type: "text",
            name: "title",
            message: theme.text.bold(`Ceremony name`),
            validate: (title: string) => {
                if (title.length <= 0)
                    return theme.colors.red(
                        `${theme.symbols.error} Please, enter a non-empty string as the name of the ceremony`
                    )

                // Check if the current name matches one of the already used prefixes.
                if (prefixesAlreadyInUse.includes(extractPrefix(title)))
                    return theme.colors.red(`${theme.symbols.error} The name is already in use for another ceremony`)

                return true
            }
        },
        {
            type: "text",
            name: "description",
            message: theme.text.bold(`Short description`),
            validate: (title: string) =>
                title.length > 0 ||
                theme.colors.red(
                    `${theme.symbols.error} Please, enter a non-empty string as the description of the ceremony`
                )
        },
        {
            type: "date",
            name: "startDate",
            message: theme.text.bold(`When should the ceremony open for contributions?`),
            validate: (d: any) =>
                new Date(d).valueOf() > Date.now()
                    ? true
                    : theme.colors.red(`${theme.symbols.error} Please, enter a date subsequent to current date`)
        }
    ]
    // Prompt questions.
    const { title, description, startDate } = await prompts(questions)

    if (!title || !description || !startDate) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    // Prompt for questions that depend on the answers to the previous ones.
    const { endDate } = await prompts({
        type: "date",
        name: "endDate",
        message: theme.text.bold(`When should the ceremony stop accepting contributions?`),
        validate: (d) =>
            new Date(d).valueOf() > new Date(startDate).valueOf()
                ? true
                : theme.colors.red(`${theme.symbols.error} Please, enter a date subsequent to starting date`)
    })

    if (!endDate) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    process.stdout.write("\n")

    // Prompt for timeout mechanism type selection.
    const { timeoutMechanismType } = await prompts({
        type: "select",
        name: "timeoutMechanismType",
        message: theme.text.bold(
            "Select the methodology for deciding to unblock the queue due to contributor disconnection, extreme slow computation, or malicious behavior"
        ),
        choices: [
            {
                title: "Dynamic (self-update approach based on latest contribution time)",
                value: CeremonyTimeoutType.DYNAMIC
            },
            {
                title: "Fixed (approach based on a fixed amount of time)",
                value: CeremonyTimeoutType.FIXED
            }
        ],
        initial: 0
    })

    if (timeoutMechanismType !== CeremonyTimeoutType.DYNAMIC && timeoutMechanismType !== CeremonyTimeoutType.FIXED)
        showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    // Prompt for penalty.
    const { penalty } = await prompts({
        type: "number",
        name: "penalty",
        message: theme.text.bold(
            `How long should a user have to attend before they can join the waiting queue again after a detected blocking situation? Please, express the value in minutes`
        ),
        validate: (pnlt: number) => {
            if (pnlt < 1)
                return theme.colors.red(`${theme.symbols.error} Please, enter a penalty at least one minute long`)

            return true
        }
    })

    if (!penalty) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    return {
        title,
        description,
        startDate,
        endDate,
        timeoutMechanismType,
        penalty
    }
}

/**
 * Prompt a series of questios to gather input about the Circom compiler.
 * @returns <Promise<CircomCompilerData>> - the necessary information for the Circom compiler used for the circuits.
 */
export const promptCircomCompiler = async (): Promise<CircomCompilerData> => {
    const questions: Array<PromptObject> = [
        {
            type: "text",
            name: "version",
            message: theme.text.bold(`Circom compiler version (x.y.z)`),
            validate: (version: string) => {
                if (version.length <= 0 || !version.match(/^[0-9].[0-9.].[0-9]$/))
                    return theme.colors.red(
                        `${theme.symbols.error} Please, provide a valid Circom compiler version (e.g., 2.0.5)`
                    )

                return true
            }
        },
        {
            type: "text",
            name: "commitHash",
            message: theme.text.bold(`The hash of the Github commit linked to the version of the Circom compiler`),
            validate: (commitHash: string) =>
                commitHash.length === 40 ||
                theme.colors.red(
                    `${theme.symbols.error} Please, provide a valid commit hash (e.g., b7ad01b11f9b4195e38ecc772291251260ab2c67)`
                )
        }
    ]

    const { version, commitHash } = await prompts(questions)

    if (!version || !commitHash) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    return {
        version,
        commitHash
    }
}

/**
 * Shows a list of circuits for a single option selection.
 * @dev the circuit names are derived from local R1CS files.
 * @param options <Array<string>> - an array of circuits names.
 * @returns Promise<string> - the name of the choosen circuit.
 */
export const promptCircuitSelector = async (options: Array<string>): Promise<string> => {
    const { circuitFilename } = await prompts({
        type: "select",
        name: "circuitFilename",
        message: theme.text.bold("Select the R1CS file related to the circuit you want to add to the ceremony"),
        choices: options.map((option: string) => ({ title: option, value: option })),
        initial: 0
    })

    if (!circuitFilename) showError(COMMAND_ERRORS.COMMAND_ABORT_SELECTION, true)

    return circuitFilename
}

/**
 * Show a series of questions about the circuits.
 * @param timeoutMechanismType <CeremonyTimeoutType> - the choosen timeout mechanism type for the ceremony.
 * @param needPromptCircomCompiler <boolean> - a boolean value indicating if the questions related to the Circom compiler version and commit hash must be asked.
 * @returns Promise<Array<Circuit>> - circuit info prompted by the coordinator.
 */
export const promptCircuitInputData = async (
    timeoutMechanismType: CeremonyTimeoutType,
    sameCircomCompiler: boolean
): Promise<CircuitInputData> => {
    // State data.
    let circuitTemplateConfigurationValues: Array<string> = []
    let dynamicTimeoutThreshold: number = 0
    let fixedTimeoutTimeWindow: number = 0
    let circomVersion: string = ""
    let circomCommitHash: string = ""
    let circuitInputData: CircuitInputData

    const questions: Array<PromptObject> = [
        {
            type: "text",
            name: "description",
            message: theme.text.bold(`Short description`),
            validate: (title: string) =>
                title.length > 0 ||
                theme.colors.red(
                    `${theme.symbols.error} Please, enter a non-empty string as the description of the circuit`
                )
        },
        {
            name: "externalReference",
            type: "text",
            message: theme.text.bold(`The external link to the circuit template`),
            validate: (value) =>
                value.length > 0 && value.match(/(https?:\/\/[^\s]+\.circom$)/g)
                    ? true
                    : theme.colors.red(
                          `${theme.symbols.error} Please, provide a valid link to the circuit template (e.g., https://github.com/iden3/circomlib/blob/master/circuits/poseidon.circom)`
                      )
        },
        {
            name: "templateCommitHash",
            type: "text",
            message: theme.text.bold(`The hash of the Github commit linked to the circuit template`),
            validate: (commitHash: string) =>
                commitHash.length === 40 ||
                theme.colors.red(
                    `${theme.symbols.error} Please, provide a valid commit hash (e.g., b7ad01b11f9b4195e38ecc772291251260ab2c67)`
                )
        }
    ]

    // Prompt for circuit data.
    const { description, externalReference, templateCommitHash } = await prompts(questions)

    if (!description || !externalReference || !templateCommitHash) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    // Ask for circuit configuration.
    const { confirmation: needConfiguration } = await askForConfirmation(
        `Did the circuit template require configuration with parameters?`,
        `Yes`,
        `No`
    )

    if (needConfiguration === undefined) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    if (needConfiguration) {
        // Ask for values if needed config.
        const { circuitTemplateValues } = await prompts({
            name: "circuitTemplateValues",
            type: "text",
            message: theme.text.bold(`Circuit template configuration in a comma-separated list of values`),
            validate: (value: string) =>
                (value.split(",").length === 1 && !!value) ||
                (value.split(`,`).length > 1 && value.includes(",")) ||
                theme.colors.red(
                    `${theme.symbols.error} Please, provide a correct comma-separated list of values (e.g., 10,2,1,2)`
                )
        })

        if (circuitTemplateValues === undefined) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

        circuitTemplateConfigurationValues = circuitTemplateValues.split(",")
    }

    // Prompt for Circom compiler info (if needed).
    if (!sameCircomCompiler) {
        const { version, commitHash } = await promptCircomCompiler()

        circomVersion = version
        circomCommitHash = commitHash
    }

    // Ask for dynamic timeout mechanism data.
    if (timeoutMechanismType === CeremonyTimeoutType.DYNAMIC) {
        const { dynamicThreshold } = await prompts({
            type: "number",
            name: "dynamicThreshold",
            message: theme.text.bold(
                `The dynamic timeout requires an acceptance threshold (expressed in %) to avoid disqualifying too many contributors for non-critical issues.\nFor example, suppose we set a threshold at 20%. If the average contribution is 10 minutes, the next contributor has 12 minutes to complete download, computation, and upload (verification is NOT included).\nTherefore, assuming it took 11:30 minutes, the next contributor will have (10 + 11:30) / 2 = 10:45 + 20% = 2:15 + 10:45 = 13 minutes total.\nPlease, set your threshold`
            ),
            validate: (value: number) => {
                if (value === undefined || value < 0 || value > 100)
                    return theme.colors.red(
                        `${theme.symbols.error} Please, provide a valid threshold selecting a value between [0-100]%. We suggest at least 25%.`
                    )

                return true
            }
        })

        if (dynamicThreshold === undefined || dynamicThreshold < 0 || dynamicThreshold > 100)
            showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

        dynamicTimeoutThreshold = dynamicThreshold

        circuitInputData = {
            description,
            dynamicThreshold: dynamicTimeoutThreshold,
            compiler: {
                version: circomVersion,
                commitHash: circomCommitHash
            },
            template: {
                source: externalReference,
                commitHash: templateCommitHash,
                paramsConfiguration: circuitTemplateConfigurationValues
            }
        }
    } else {
        // Ask for fixed timeout mechanism data.
        const { fixedTimeWindow } = await prompts({
            type: "number",
            name: `fixedTimeWindow`,
            message: theme.text.bold(
                `The fixed timeout requires a fixed time window for contribution. Your time window in minutes`
            ),
            validate: (value: number) => {
                if (value <= 0)
                    return theme.colors.red(`${theme.symbols.error} Please, provide a time window greater than zero`)

                return true
            }
        })

        if (fixedTimeWindow === undefined || fixedTimeWindow <= 0) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

        fixedTimeoutTimeWindow = fixedTimeWindow

        circuitInputData = {
            description,
            fixedTimeWindow: fixedTimeoutTimeWindow,
            compiler: {
                version: circomVersion,
                commitHash: circomCommitHash
            },
            template: {
                source: externalReference,
                commitHash: templateCommitHash,
                paramsConfiguration: circuitTemplateConfigurationValues
            }
        }
    }

    return circuitInputData
}

/**
 * Prompt for asking if the same circom compiler version has been used for all circuits of the ceremony.
 * @returns <Promise<boolean>>
 */
export const promptSameCircomCompiler = async (): Promise<boolean> => {
    const { confirmation: sameCircomCompiler } = await askForConfirmation(
        "Did the circuits of the ceremony were compiled with the same version of circom?",
        "Yes",
        "No"
    )

    if (sameCircomCompiler === undefined) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    return sameCircomCompiler
}

/**
 * Prompt for asking if the coordinator wanna use a pre-computed zKey for the given circuit.
 * @returns <Promise<boolean>>
 */
export const promptPreComputedZkey = async (): Promise<boolean> => {
    const { confirmation: wannaUsePreComputedZkey } = await askForConfirmation(
        "Would you like to use a pre-computed zKey for this circuit?",
        "Yes",
        "No"
    )

    if (wannaUsePreComputedZkey === undefined) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    return wannaUsePreComputedZkey
}

/**
 * Prompt for asking if the coordinator wants to add a new circuit to the ceremony.
 * @returns <Promise<boolean>>
 */
export const promptCircuitAddition = async (): Promise<boolean> => {
    const { confirmation: wannaAddNewCircuit } = await askForConfirmation(
        "Want to add another circuit for the ceremony?",
        "Yes",
        "No"
    )

    if (wannaAddNewCircuit === undefined) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    return wannaAddNewCircuit
}

/**
 * Shows a list of pre-computed zKeys for a single option selection.
 * @dev the names are derived from local zKeys files.
 * @param options <Array<string>> - an array of pre-computed zKeys names.
 * @returns Promise<string> - the name of the choosen pre-computed zKey.
 */
export const promptPreComputedZkeySelector = async (options: Array<string>): Promise<string> => {
    const { preComputedZkeyFilename } = await prompts({
        type: "select",
        name: "preComputedZkeyFilename",
        message: theme.text.bold("Select the pre-computed zKey file related to the circuit"),
        choices: options.map((option: string) => ({ title: option, value: option })),
        initial: 0
    })

    if (!preComputedZkeyFilename) showError(COMMAND_ERRORS.COMMAND_ABORT_SELECTION, true)

    return preComputedZkeyFilename
}

/**
 * Prompt asking to the coordinator to choose the desired PoT file for the zKey for the circuit.
 * @param suggestedSmallestNeededPowers <number> - the minimal number of powers necessary for circuit zKey generation.
 * @returns Promise<number> - the selected amount of powers.
 */
export const promptNeededPowersForCircuit = async (suggestedSmallestNeededPowers: number): Promise<number> => {
    const question: PromptObject = {
        name: "choosenPowers",
        type: "number",
        message: theme.text.bold(`Specify the amount of Powers of Tau used to generate the pre-computed zKey`),
        validate: (value) =>
            value >= suggestedSmallestNeededPowers && value <= 28
                ? true
                : theme.colors.red(
                      `${theme.symbols.error} Please, provide a valid amount of powers selecting a value between [${suggestedSmallestNeededPowers}-28].  ${suggestedSmallestNeededPowers}`
                  )
    }

    // Prompt for circuit data.
    const { choosenPowers } = await prompts(question)

    if (choosenPowers === undefined || Number(choosenPowers) < suggestedSmallestNeededPowers)
        showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    return choosenPowers
}

/**
 * Shows a list of PoT files for a single option selection.
 * @dev the names are derived from local PoT files.
 * @param options <Array<string>> - an array of PoT file names.
 * @returns Promise<string> - the name of the choosen PoT.
 */
export const promptPotSelector = async (options: Array<string>): Promise<string> => {
    const { potFilename } = await prompts({
        type: "select",
        name: "potFilename",
        message: theme.text.bold("Select the Powers of Tau file choosen for the circuit"),
        choices: options.map((option: string) => {
            console.log(option)
            return { title: option, value: option }
        }),
        initial: 0
    })

    if (!potFilename) showError(COMMAND_ERRORS.COMMAND_ABORT_SELECTION, true)

    return potFilename
}

/**
 * Prompt for asking the coordinator to compute a new zKey from scratch.
 * @returns <Promise<boolean>>
 */
export const promptZkeyGeneration = async (): Promise<boolean> => {
    const { confirmation: wannaAddNewCircuit } = await askForConfirmation(
        `Would you like to generate a new zKey from scratch? If not, the whole setup process will be interrupted and you will LOSE all the changes you have made so far.`,
        `Yes, generate a new zKey`,
        `No, abort the setup process`
    )

    if (wannaAddNewCircuit === undefined) showError(COMMAND_ERRORS.COMMAND_ABORT_PROMPT, true)

    return wannaAddNewCircuit
}

/** --- */

/**
 * Prompt for entropy or beacon.
 * @param askEntropy <boolean> - true when requesting entropy; otherwise false.
 * @returns <Promise<string>>
 */
export const askForEntropyOrBeacon = async (askEntropy: boolean): Promise<string> => {
    const { entropyOrBeacon } = await prompts({
        type: "text",
        name: "entropyOrBeacon",
        style: `${askEntropy ? `password` : `text`}`,
        message: theme.text.bold(`Provide ${askEntropy ? `some entropy` : `the final beacon`}`),
        validate: (title: string) =>
            title.length > 0 ||
            theme.colors.red(
                `${theme.symbols.error} You must provide a valid value for the ${askEntropy ? `entropy` : `beacon`}!`
            )
    })

    if (!entropyOrBeacon) showError(GENERIC_ERRORS.GENERIC_DATA_INPUT, true)

    return entropyOrBeacon
}

/**
 * Handle the request/generation for a random entropy or beacon value.
 * @param askEntropy <boolean> - true when requesting entropy; otherwise false.
 * @return <Promise<string>>
 */
export const getEntropyOrBeacon = async (askEntropy: boolean): Promise<string> => {
    let entropyOrBeacon: any
    let randomEntropy = false

    if (askEntropy) {
        // Prompt for entropy.
        const { confirmation } = await askForConfirmation(`Do you prefer to enter entropy manually?`)
        if (confirmation === undefined) showError(GENERIC_ERRORS.GENERIC_DATA_INPUT, true)

        randomEntropy = !confirmation
    }

    if (randomEntropy) {
        // Took inspiration from here https://github.com/glamperd/setup-mpc-ui/blob/master/client/src/state/Compute.tsx#L112.
        entropyOrBeacon = new Uint8Array(256).map(() => Math.random() * 256).toString()
    }

    if (!askEntropy || !randomEntropy) entropyOrBeacon = await askForEntropyOrBeacon(askEntropy)

    return entropyOrBeacon
}

/**
 * Prompt the list of opened ceremonies for selection.
 * @param openedCeremoniesDocs <Array<FirebaseDocumentInfo>> - The uid and data of opened cerimonies documents.
 * @returns Promise<FirebaseDocumentInfo>
 */
export const askForCeremonySelection = async (
    openedCeremoniesDocs: Array<FirebaseDocumentInfo>
): Promise<FirebaseDocumentInfo> => {
    const choices: Array<Choice> = []

    // Make a 'Choice' for each opened ceremony.
    for (const ceremonyDoc of openedCeremoniesDocs) {
        const now = Date.now()
        const daysLeft = Math.ceil(Math.abs(now - ceremonyDoc.data.endDate) / (1000 * 60 * 60 * 24))

        choices.push({
            title: ceremonyDoc.data.title,
            description: `${ceremonyDoc.data.description} (${theme.colors.magenta(daysLeft)} ${
                now - ceremonyDoc.data.endDate < 0 ? `days left` : `days gone since closing`
            })`,
            value: ceremonyDoc
        })
    }

    // Ask for selection.
    const { ceremony } = await prompts({
        type: "select",
        name: "ceremony",
        message: theme.text.bold("Select a ceremony"),
        choices,
        initial: 0
    })

    if (!ceremony) showError(GENERIC_ERRORS.GENERIC_CEREMONY_SELECTION, true)

    return ceremony
}

/**
 * Prompt the list of circuits for a specific ceremony for selection.
 * @param circuitsDocs <Array<FirebaseDocumentInfo>> - The uid and data of ceremony circuits.
 * @returns Promise<FirebaseDocumentInfo>
 */
export const askForCircuitSelectionFromFirebase = async (
    circuitsDocs: Array<FirebaseDocumentInfo>
): Promise<FirebaseDocumentInfo> => {
    const choices: Array<Choice> = []

    // Make a 'Choice' for each circuit.
    for (const circuitDoc of circuitsDocs) {
        choices.push({
            title: `${circuitDoc.data.name}`,
            description: `(#${theme.colors.magenta(circuitDoc.data.sequencePosition)}) ${circuitDoc.data.description}`,
            value: circuitDoc
        })
    }

    // Ask for selection.
    const { circuit } = await prompts({
        type: "select",
        name: "circuit",
        message: theme.text.bold("Select a circuit"),
        choices,
        initial: 0
    })

    if (!circuit) showError(GENERIC_ERRORS.GENERIC_CIRCUIT_SELECTION, true)

    return circuit
}
