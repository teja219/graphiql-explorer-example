import React, { Component } from "react";
import { render } from 'react-dom';
import { AgGridReact } from 'ag-grid-react';
import GraphiQL from "graphiql";
import GraphiQLExplorer from "graphiql-explorer";
import { buildClientSchema, getIntrospectionQuery, parse } from "graphql";

import { makeDefaultArg, getDefaultScalarArgValue } from "./CustomArgs";
import 'ag-grid-community/dist/styles/ag-grid.css';
import 'ag-grid-community/dist/styles/ag-theme-alpine.css';
import "graphiql/graphiql.css";
import "./App.css";

import type { GraphQLSchema } from "graphql";


function isPrimitive(val){
    if(val === null){
        return true;
    }

    if(typeof val == "object" || typeof val == "function"){
        return false;
    }else{
        return true;
    }
}
function constructTableWrapper(data,path){
    var result = constructTable(data,path);
    result.rows = result.rows.map(row => {
        var rowNew = {};
        for(var k1 in row){
            rowNew[k1] = row[k1];
        }
        for(var k2 in result.referenceData){
            rowNew[k2] = result.referenceData[k2];
        }
        return rowNew;
    })
    result.columns = result.columns.concat(Object.keys(result.referenceData).map(k=>({field: k,cellStyle: {fontSize: '11px'} })))
    return result;
}
function constructTable(data,path) {
    var columns = [];
    var rows = [];
    var referenceData = {};

    if(Array.isArray(data)){
        rows = data;
        columns = Object.keys(rows[0]).map(item => ({field: item,cellStyle: {fontSize: '11px'} }));
        return {
            isTable: 1,
            rows : rows,
            columns : columns,
            countTables: 1,
            referenceData: {}
        }
    }
    if(isPrimitive(data)){
        return {
            isTable: 0,
            rows : [],
            columns : [],
            countTables: 0,
            referenceData: { [path]: data }
        }
    }
    var countTables = 0;
    for(var k in data){
        if(path === ""){
            path = k;
        }
        else{
            path = k + "_" + path;
        }
        var result = constructTable(data[k],path);
        if(result.isTable === 1){
            countTables = countTables + 1;
            rows = result.rows;
            columns = result.columns;
        }
        if(countTables >= 2 || result.countTables>1){
            return {
                isTable: 0,
                rows : [],
                columns : [],
                countTables: 2,
                referenceData: {}
            }
        }
        for(var kr in result.referenceData){
            referenceData[kr] = result.referenceData[kr];
        }
    }
    var isTable = 0;
    if(countTables === 1){
        isTable= 1;
    }
    return {
        isTable: isTable,
        rows : rows,
        columns : columns,
        countTables: 1,
        referenceData: referenceData
    }
}
const DEFAULT_QUERY = `# shift-option/alt-click on a query below to jump to it in the explorer
# option/alt-click on a field in the explorer to select all subfields
query npmPackage {
  npm {
    package(name: "onegraph-apollo-client") {
      downloads {
        lastMonth {
          perDay {
            count
            day
          }
        }
      }
    }
  }
}
`;

type State = {
      schema: ?GraphQLSchema,
      query: string,
      explorerIsOpen: boolean,
      rowData: [],
      columnData: []
};

class App extends Component<{}, State> {
  _graphiql: GraphiQL;
  constructor(props) {
      super(props);
      this.state = {
          schema: null,
          query: DEFAULT_QUERY,
          explorerIsOpen: true,
          defaultColDef: {
              resizable: true
          }
      };
      this._fetcher = this._fetcher.bind(this);
  }

  _fetcher = params => {

      return fetch(
          "https://serve.onegraph.com/dynamic?app_id=c333eb5b-04b2-4709-9246-31e18db397e1",
          {
              method: "POST",
              headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json"
              },
              body: JSON.stringify(params)
          }
      ).then(function(response) {
              return response.text();
      }.bind(this)).then(function(responseBody) {
          try {
              var responseBodyData = JSON.parse(responseBody);
              var data = responseBodyData.data;
              var result = constructTableWrapper(data,"");

              if(result.rows.length > 0){
                  this.setState({ rowData: result.rows, columnData: result.columns });
              }
              return responseBodyData;
          } catch (e) {
              return responseBody;
          }
      }.bind(this));
    }
  componentDidMount() {
    this._fetcher({
      query: getIntrospectionQuery()
    }).then(result => {
      const editor = this._graphiql.getQueryEditor();
      editor.setOption("extraKeys", {
        ...(editor.options.extraKeys || {}),
        "Shift-Alt-LeftClick": this._handleInspectOperation
      });

      this.setState({ schema: buildClientSchema(result.data) });
    });
  }

  _handleInspectOperation = (
    cm: any,
    mousePos: { line: Number, ch: Number }
  ) => {
    const parsedQuery = parse(this.state.query || "");

    if (!parsedQuery) {
      console.error("Couldn't parse query document");
      return null;
    }

    var token = cm.getTokenAt(mousePos);
    var start = { line: mousePos.line, ch: token.start };
    var end = { line: mousePos.line, ch: token.end };
    var relevantMousePos = {
      start: cm.indexFromPos(start),
      end: cm.indexFromPos(end)
    };

    var position = relevantMousePos;

    var def = parsedQuery.definitions.find(definition => {
      if (!definition.loc) {
        console.log("Missing location information for definition");
        return false;
      }

      const { start, end } = definition.loc;
      return start <= position.start && end >= position.end;
    });

    if (!def) {
      console.error(
        "Unable to find definition corresponding to mouse position"
      );
      return null;
    }

    var operationKind =
      def.kind === "OperationDefinition"
        ? def.operation
        : def.kind === "FragmentDefinition"
        ? "fragment"
        : "unknown";

    var operationName =
      def.kind === "OperationDefinition" && !!def.name
        ? def.name.value
        : def.kind === "FragmentDefinition" && !!def.name
        ? def.name.value
        : "unknown";

    var selector = `.graphiql-explorer-root #${operationKind}-${operationName}`;

    var el = document.querySelector(selector);
    el && el.scrollIntoView();
  };

  _handleEditQuery = (query: string): void => this.setState({ query });

  _handleToggleExplorer = () => {
    this.setState({ explorerIsOpen: !this.state.explorerIsOpen });
  };

  render() {
    const { query, schema } = this.state;

    return (
        <div>
            <div className="graphiql-container">
                <GraphiQLExplorer
                    schema={schema}
                    query={query}
                    onEdit={this._handleEditQuery}
                    onRunOperation={operationName =>
                        this._graphiql.handleRunQuery(operationName)
                    }
                    explorerIsOpen={this.state.explorerIsOpen}
                    onToggleExplorer={this._handleToggleExplorer}
                    getDefaultScalarArgValue={getDefaultScalarArgValue}
                    makeDefaultArg={makeDefaultArg}
                />
                <GraphiQL
                    ref={ref => (this._graphiql = ref)}
                    fetcher={this._fetcher}
                    schema={schema}
                    query={query}
                    onEditQuery={this._handleEditQuery}
                >
                    <GraphiQL.Toolbar>
                        <GraphiQL.Button
                            onClick={() => this._graphiql.handlePrettifyQuery()}
                            label="Prettify"
                            title="Prettify Query (Shift-Ctrl-P)"
                        />
                        <GraphiQL.Button
                            onClick={() => this._graphiql.handleToggleHistory()}
                            label="History"
                            title="Show History"
                        />
                        <GraphiQL.Button
                            onClick={this._handleToggleExplorer}
                            label="Explorer"
                            title="Toggle Explorer"
                        />
                    </GraphiQL.Toolbar>
                </GraphiQL>
        </div>
        <div className="utility-bar">
            Results:
        </div>
        <div className="grid">
            <AgGridReact
                rowData={this.state.rowData} columnDefs={this.state.columnData}
                defaultColDef={this.state.defaultColDef}  enableColResize={true}
            >

            </AgGridReact>
        </div>
        </div>


    );
  }
}

export default App;
