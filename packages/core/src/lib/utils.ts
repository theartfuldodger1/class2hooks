import j, {
  ImportDeclaration,
  ASTNode,
  ImportSpecifier,
  ClassDeclaration,
  MethodDefinition
} from "jscodeshift"
import { NodePath } from "ast-types"
import { Collection } from "jscodeshift/src/Collection"
import { runInlineTest } from "jscodeshift/src/testUtils"
import { join } from "path"
import { readFileSync } from "fs"
import { RuntimeOptions } from "./types"

const findModule = (
  path: Collection<ASTNode>,
  module: String
): Collection<ImportDeclaration> =>
  path
    .find(ImportDeclaration, {
      type: "ImportDeclaration",
      source: {
        type: "Literal"
      }
    })
    .filter(declarator => declarator.value.source.value === module)

// ---------------------------------------------------------------------------
// Checks if the file imports a certain module
const hasModule = (path: Collection<ASTNode>, module: String) =>
  findModule(path, module).size() === 1

// ---------------------------------------------------------------------------
// Checks if the file imports a React module
const hasReact = (path: Collection<ASTNode>) =>
  hasModule(path, "React") ||
  hasModule(path, "react") ||
  hasModule(path, "react-native")

const hasOnlyRenderMethod = (path: NodePath) =>
  j(path)
    .find(MethodDefinition)
    .filter(p => !isRenderMethod(p.value))
    .size() === 0

// ---------------------------------------------------------------------------
// Finds alias for React.Component if used as named import.
const findReactComponentNameByParent = (
  path: Collection<ASTNode>,
  parentClassName: String
): String | undefined => {
  const reactImportDeclaration = path
    .find(ImportDeclaration, {
      type: "ImportDeclaration",
      source: {
        type: "Literal"
      }
    })
    .filter(() => hasReact(path))

  const componentImportSpecifier = reactImportDeclaration
    .find(ImportSpecifier, {
      type: "ImportSpecifier",
      imported: {
        type: "Identifier",
        name: parentClassName
      }
    })
    .at(0)

  const paths = componentImportSpecifier.paths()
  return paths.length ? paths[0].value.local.name : undefined
}

const findReactES6ClassDeclarationByParent = (
  path: Collection<ASTNode>,
  parentClassName: String
): Collection<ClassDeclaration> => {
  const componentImport = findReactComponentNameByParent(path, parentClassName)

  const selector = componentImport
    ? {
        superClass: {
          type: "Identifier",
          name: componentImport
        }
      }
    : {
        superClass: {
          type: "MemberExpression",
          object: {
            type: "Identifier",
            name: "React"
          },
          property: {
            type: "Identifier",
            name: "Component"
          }
        }
      }

  return path.find(ClassDeclaration, selector)
}

// Finds all classes that extend React.Component
const findReactES6ClassDeclaration = (
  path: Collection<ASTNode>
): Collection<ClassDeclaration> => {
  let classDeclarations = findReactES6ClassDeclarationByParent(
    path,
    "Component"
  )
  if (classDeclarations.size() === 0) {
    classDeclarations = findReactES6ClassDeclarationByParent(
      path,
      "PureComponent"
    )
  }
  return classDeclarations
}

// ---------------------------------------------------------------------------
// Checks if the file has React ES6 Class Components
const hasReactES6Class = (path: Collection<ASTNode>): Boolean =>
  findReactES6ClassDeclaration(path).size() > 0

// ---------------------------------------------------------------------------
// Finds JSX in file
const findJSX = (path: Collection<ASTNode>): Collection<ASTNode> =>
  path.findJSXElements()

// ---------------------------------------------------------------------------
// Checks if the file has JSX
const hasJSX = (path: Collection<ASTNode>): Boolean => findJSX(path).size() > 0

// ---------------------------------------------------------------------------
// Filter our path down to a collection of AST nodes that ONLY contains items in the following form:
// ClassBody -> MethodDefinition -> Value -> Key -> KeyName : [fnName]. If [fnName] === untransformable, then we add it to our modified path collection.
const findComponentDidCatchMethod = (
  path: Collection<ASTNode>
): Collection<ASTNode> =>
  path
    .find(MethodDefinition)
    .filter(element => element.value.key["name"] === "componentDidCatch")

// ---------------------------------------------------------------------------
// Checks if the file has findComponentDidCatch Method. If our path has 1 or more componentDidCatchMethods, return true
const hasComponentDidCatchMethod = (path: Collection<ASTNode>): Boolean =>
  findComponentDidCatchMethod(path).size() > 0

// ---------------------------------------------------------------------------
// Filter our path down to a collection of AST nodes that ONLY contains items in the following form:
// ClassBody -> MethodDefinition -> Value -> Key -> KeyName : [fnName]. If [fnName] === untransformable, then we add it to our modified path collection.
const findGetDerivedStateFromErrorMethod = (
  path: Collection<ASTNode>
): Collection<ASTNode> =>
  path
    .find(MethodDefinition)
    .filter(element => element.value.key["name"] === "getDerivedStateFromError")

// ---------------------------------------------------------------------------
// Checks if the file has findGetDerivedStateFromError Method. If our path has 1 or more 'getDerivedStateFromError's, return true
const hasGetDerivedStateFromErrorMethod = (
  path: Collection<ASTNode>
): Boolean => findGetDerivedStateFromErrorMethod(path).size() > 0

// ---------------------------------------------------------------------------
// Get the name of a Class
const getClassName = (
  path: NodePath<ClassDeclaration, ClassDeclaration>
): string => path.node.id.name

// ---------------------------------------------------------------------------
// Checks if a node is a render method
const isRenderMethod = (node: ASTNode) =>
  node.type == "MethodDefinition" &&
  node.key.type == "Identifier" &&
  node.key.name == "render"

// ---------------------------------------------------------------------------
// Bails out of transformation & prints message to console
const skipTransformation = (path: Collection<ASTNode>, msg: string) =>
  // TODO: Add better error reporting
  console.warn(msg)

// ---------------------------------------------------------------------------
// Jest bootstapping fn to run fixtures
const runTest = (
  dirName: string,
  transformName: string,
  options?: RuntimeOptions,
  testFilePrefix?: string
) => {
  if (!testFilePrefix) {
    testFilePrefix = transformName
  }

  const fixtureDir: string = join(
    dirName,
    "..",
    transformName,
    "__testfixtures__"
  )
  const inputPath: string = join(fixtureDir, "index.input.js")
  const source: string = readFileSync(inputPath, "utf8")
  const expectedOutput: string = readFileSync(
    join(fixtureDir, "index.output.js"),
    "utf8"
  )
  // Assumes transform is one level up from __tests__ directory
  const module: NodeModule = require(join(
    dirName,
    "..",
    transformName,
    "index.ts"
  ))

  runInlineTest(
    module,
    options,
    {
      path: inputPath,
      source
    },
    expectedOutput
  )
}

const defineTest = (
  dirName: string,
  transformName: string,
  options?: RuntimeOptions,
  testFilePrefix?: string
) => {
  const testName = testFilePrefix
    ? `transforms correctly using "${testFilePrefix}" data`
    : "transforms correctly"
  describe(transformName, () => {
    it(testName, () => {
      runTest(dirName, transformName, options, testFilePrefix)
    })
  })
}

export {
  hasModule,
  hasReact,
  hasReactES6Class,
  hasJSX,
  hasComponentDidCatchMethod,
  hasGetDerivedStateFromErrorMethod,
  hasOnlyRenderMethod,
  findReactComponentNameByParent,
  findReactES6ClassDeclaration,
  findReactES6ClassDeclarationByParent,
  findJSX,
  findComponentDidCatchMethod,
  findGetDerivedStateFromErrorMethod,
  findModule,
  getClassName,
  isRenderMethod,
  skipTransformation,
  defineTest
}
