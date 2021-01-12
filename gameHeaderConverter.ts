import * as fs from "fs";

const internalTypes = new Set([
    'void',
    'char',
    'unsigned char',
    'short',
    'unsigned short',
    'int',
    'unsigned int',
    'double',
    'float',
    'long',
]);

const pushType = (something: Type) => {
    if (TypeMap[something.name]) {
        throw new Error('Type ' + something.name + ' already exists');
    }
    return TypeMap[something.name] = something;
}
const TypeMap: { [data: string]: Type } = {}

class Type {
    name: string;

    constructor(name) {
        this.name = name;
        pushType(this);
        const staticClass = Object.getPrototypeOf(this).constructor;
        staticClass.instances.push(this);
    }

    static factory<T extends Type>(this: (new(...args: any) => T), name): T {
        name = name.replace('*', '');
        const other: Type = TypeMap[name];
        if (other instanceof this) {
            return other as T;
        }

        return new this(name);
    }

    static isSelfType<T>(this: (new (...args: any) => T), check: unknown): check is T {
        return check && check instanceof this;
    }

    static hasDepends<T>(this: (new (...args: any) => T), check: unknown): check is T & { depends: Set<string> } {
        return check && (check as { depends }).depends instanceof Set;
    }
}

class Enum extends Type {
    fields: [string, number][] = [];

    static readonly instances: Enum[] = [];

}

class Typedef extends Type {
    type: string;
    depends: Set<string> = new Set();
    isFunc: boolean = false;

    static readonly instances: Typedef[] = [];
}

class Union extends Type {
    fields: [string, string, string][] = [];
    depends: Set<string> = new Set();

    static readonly instances: Struct[] = [];
}

class Struct extends Type {
    fields: [string, string, string][] = [];
    depends: Set<string> = new Set();

    static readonly instances: Struct[] = [];
}

class Method {
    public readonly returnType:string;
    public readonly method:string;
    public readonly args:string;

    constructor(settings: Partial<Method>) {
        Object.assign(this,settings);
    }
}

let changed, configChanged;
const Config = {
    structs: [],
    enums: [],
    charonDirectory: '',
    ghidraFile: '',
};

const warningString = '\r\n\r\n\r\n\r\n\r\n\r\n\r\n//This file is generated, do not edit by hand\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n';

class WeakMapExt<K extends object, V> extends WeakMap<K, V> {
    private readonly defaultFactory: () => V;

    constructor(defaultFactory: () => V) {
        super();
        this.defaultFactory = defaultFactory;
    }

    getDefault(k: K): V {
        let ret = this.get(k);
        return ret || (this.set(k, ret = this.defaultFactory()) && ret);
    }
}

const methodMap = new WeakMapExt<Struct, Method[]>(() => []);

fs.watchFile(Config.ghidraFile, changed = () => {
    Object.keys(TypeMap).forEach(key => {
        delete TypeMap[key];
    });

    // clear instances
    [Enum, Typedef, Union, Struct].forEach(Obj => Obj.instances.splice(0, Enum.instances.length));

    console.time('process');

    const lines = fs.readFileSync(Config.ghidraFile).toString().split('\r\n').reverse().map(line => {
        while (line.includes(' *')) line = line.replace(' *', '* ');
        while (line.includes('  ')) line = line.replace('  ', ' ');
        return line;
    });

    let functionCallbackTicker = 0;
    try {
        let line;
        do {
            line = lines.pop();
            let words = line.split(' ');
            switch (true) {
                case words[0] === 'typedef' && words[1] === 'enum': {

                    let name = words[2];
                    const currentEnum = Enum.factory(words[2]);

                    let line;
                    while ((line = lines.pop()) !== '} ' + name + ';' && line) {
                        currentEnum.fields.push(line.split('=').map((el, index) => index ? parseInt(el) : el) as [string, number]);
                    }

                    // fix my ocd, sort the enums
                    currentEnum.fields.sort(([, a], [, b]) => a - b);

                    break;
                }

                case words[0] === 'union': {

                    const union = Union.factory(words[1]);

                    let line, comments;
                    while ((line = lines.pop().trim()) !== '};' && line) {
                        [line, comments] = line.split(' /*');
                        const tmp = line.startsWith('struct') ? line.split(' ').slice(1) : line.split(' ');
                        let fieldName = tmp[tmp.length - 1].substr(0, tmp.pop().length - 1);
                        let fieldType = tmp.join(' ');

                        union.depends.add(fieldType.replace('*', ''));
                        union.fields.push([fieldType, fieldName, (comments ? ('/*' + comments) : '').replace('* /', '*/')]);
                    }

                    break;

                }

                case words[0] === 'typedef' && !['struct', 'union'].includes(words[1]): {
                    let name = words.pop().replace(';', '');
                    let type = words.slice(1).join(' ');

                    const def = Typedef.factory(name);
                    def.type = type;
                    def.depends.add(type);

                    break;
                }

                case words[0] === 'struct': {

                    let name = words[1];
                    const currentStruct = Struct.factory(name);
                    while (lines[lines.length - 1] !== '};') {
                        let fieldType, fieldName;
                        let line = lines.pop().trim(), comments;
                        // deal with comments
                        [line, comments] = line.split(' /*');

                        // special function definition pointer
                        if (line.includes('\(')) {
                            const funcRegex = /^(\w*)\s*\((\*?\s*\S*)\)\((.*)\);.*$/g;
                            const groups = funcRegex.exec(line);
                            let [, returnType, structVarName, args] = groups || [];
                            if (args !== undefined) {
                                args = args.split(', ').map(el => ['struct ', 'union '].some(x => el.startsWith(x)) ? el.split(' ').slice(1).join('') : el).join(', ').trim();

                                const typedefName = ('callback_' + returnType + (++functionCallbackTicker) + structVarName).replace(/\W/g, '');
                                const typedef = Typedef.factory(typedefName);

                                //typedef void (* name)(D2QuestDataStrc* , D2QuestArgStrc* );
                                typedef.type = ` ${returnType} (*${typedefName})(${args})`;

                                args.split(',').forEach(arg => {
                                    let [type, name] = arg.trim().split(' ');
                                    type = type.replace('*', '');
                                    typedef.depends.add(type);
                                })
                                typedef.isFunc = true;

                                fieldType = typedefName;
                                fieldName = structVarName;
                            }

                        }
                        if (fieldName == undefined) {
                            line = line.substr(0, line.length - 1)


                            let tmp = line.split(' ').filter(el => !['enum', 'struct', 'union'].includes(el));
                            fieldName = tmp.pop();
                            fieldType = tmp.join(' ');
                        }

                        // external type
                        if (!internalTypes.has(fieldType)) {
                            currentStruct.depends.add(fieldType.replace('*', ''));
                        }

                        currentStruct.fields.push([fieldType, fieldName, !comments ? '' : '/*' + comments.replace('* /', '*/')]);
                    }

                    break;
                }
            }


        } while (lines.length);
    } catch (e) {
        throw e;
    }

    console.log('Creating dependency chain');


    const wantedType = new Map<string, Type>();
    const passedNodes = new Set<string>();

    [...(Config.enums || []), ...(Config.structs || [])].forEach(function wantedLoop(el) {
        const type = TypeMap[el.replace('*', '')];
        passedNodes.add(el);

        if (Type.hasDepends(type)) {
            type.depends.forEach(dep => {
                dep = dep.replace('*', '');
                if (passedNodes.has(dep)) return;
                if (el === dep) return; // no recursion

                if (!wantedType.has(dep)) {
                    wantedLoop(dep);
                }
            });
        }
        wantedType.set(el, type);
    });


    // compress the file
    wantedType.forEach(struct => {
        if (!(struct instanceof Struct)) return;
        if (struct.fields.length < 10) return;

        const running = {
            type: '',
            name: '',
            counter: 0,
            items: [],
        }
        struct.fields = struct.fields.reduce((acc, cur) => {
            let [type, name] = cur;

            if (name.startsWith('field_')) {
                // If not running, we are now
                if (!running.items.length) running.type = type;

                if (running.type == type) running.items.push(cur);
            } else {

                if (running.items.length !== 0) {
                    if (running.items.length < 3) {
                        // too small set
                        acc.push(...running.items.splice(0, running.items.length));
                    } else {
                        acc.push([type, '_' + (running.counter++) + '[' + running.items.length + ']', '// removed field_0xxx for space'])
                        running.items.splice(0, running.items.length);
                    }
                }
                // just normal line
                acc.push(cur);
            }

            return acc;
        }, [])
    });

    const preHeader = [];
    const typedef = [];
    const headerFile = [];
    const enums = [];

    {
        const userDefinedMethods = fs.readFileSync(Config.charonDirectory + '/framework/ghidra.extensions.cpp').toString();

        const lines = userDefinedMethods.split('\r\n').reverse();
        while (lines.length) {
            let currentLine = lines.pop();

            const isMethod = /^\s*?(\w*)\s*Ghidra\s*::\s*(\w*)\s*::\s*(\w*)\s*\((.*)\)/gm.exec(currentLine);
            if (isMethod) {
                let [, returnType, structure, method, args] = isMethod;

                const struct = TypeMap[structure];
                if (Struct.isSelfType(struct)) {
                    methodMap.getDefault(struct).push(new Method({returnType, method, args}));
                }
            }
        }
    }

// Add all structs
    wantedType.forEach(el => {
        if (el instanceof Struct || el instanceof Union) {
            const typeName = el instanceof Struct ? 'struct' : 'union';
            preHeader.push(typeName + ' ' + el.name + ';')
            headerFile.push(typeName + ' ' + el.name + '{\r\n\t' + el.fields.map(el => el.map((cur, i) => {
                if (i === 0 && TypeMap[cur.replace('*', '')] instanceof Enum) {
                    return 'enum ' + cur;
                }
                return i === 1 ? cur + ';' : cur;
            }).join(' ')).join('\r\n\t')
                +
                // Methods
                (!methodMap.has(el) ? '' : '\r\n\t'+methodMap.get(el).map(({returnType, method, args}) => [returnType,method, '('+args+')'].join(' ')).join(';\r\n\t')+';')
                + '\r\n};\r\n');
        }
        if (el instanceof Typedef) {
            // skip those types that c++ already have
            if (!['bool', 'wchar_t'].includes(el.name)) {
                typedef.push('typedef ' + el.type + ' ' + (el.isFunc ? '' : el.name) + ';');
            }
        }
        if (el instanceof Enum) {
            enums.push('typedef enum ' + el.name + '{');
            enums.push('\t' + el.fields.map(el => el.join('=')).join(',\r\n\t'));
            enums.push('}' + el.name + ';\r\n')
        }
    });

    const shorthands = [
        'char string', // ghidra defines a char as a string
        'unsigned int pointer', // some how pointer isnt defined properly by ghidra
    ]

    fs.writeFileSync(Config.charonDirectory + '/headers/ghidra.h', [warningString,
        '#pragma once',
        '#include "./ghidra.enums.h"',
        '#include "./ghidra.naked.h"',
        'namespace Ghidra {',
        'typedef ' + (shorthands.join(';\r\ntypedef ') + ';'),
        ...typedef, ...headerFile,
        '}; // ghidra namespace'].join('\r\n'));

    fs.writeFileSync(Config.charonDirectory + '/headers/ghidra.naked.h', [
        warningString,
        '#pragma once',
        'namespace Ghidra {',
        ...preHeader,
        '}; // ghidra namespace',
    ].join('\r\n'));

    fs.writeFileSync(Config.charonDirectory + '/headers/ghidra.enums.h', ['#pragma once\r\nnamespace Ghidra {', ...enums, '};//ghidra namespace'].join('\r\n'));

    console.timeEnd('process');
});

fs.watchFile(Config.charonDirectory+'/framework/ghidra.extensions.cpp', changed);

fs.watchFile('./StructureConfig.json', configChanged = () => {
    const json = fs.readFileSync('./StructureConfig.json');
    try {
        let _tmp = JSON.parse(json.toString());
        const oldGhidra = Config.ghidraFile;
        Object.keys(_tmp).forEach(key => Config[key] = _tmp[key]);
        if (oldGhidra !== Config.ghidraFile) {
            fs.unwatchFile(Config.ghidraFile);
            fs.watchFile(Config.ghidraFile, changed);
            fs.unwatchFile(Config.charonDirectory+'/framework/ghidra.extensions.cpp');
            fs.watchFile(Config.charonDirectory+'/framework/ghidra.extensions.cpp', changed);
        }
        changed();
    } catch (e) {
        console.error('Error in json:' + e.message);
    }
});

configChanged();
